import * as vscode from 'vscode';
import { languageName } from './languages.js';
import { isEnglishLanguageCode } from '@kren/core/languages';
import type {
  DictionaryResult,
  DictionarySection,
  GrammarResult,
  KrenResult,
  RewriteResult,
  ThesaurusResult,
  ThesaurusWord
} from './types.js';

const providerNames: Record<string, string> = {
  harper: 'Harper (offline)',
  gemini: 'Gemini',
  googleCloudTranslation: 'Google Cloud Translation',
  koreanBasicDictionary: 'Korean Basic Dictionary',
  merriamWebsterCollegiate: "Merriam-Webster's Collegiate® Dictionary",
  merriamWebsterMedical: "Merriam-Webster's Medical Dictionary",
  merriamWebsterThesaurus: "Merriam-Webster's Collegiate® Thesaurus"
};

export function renderResultMarkdown(
  result: KrenResult,
  assetBaseUri?: vscode.Uri
): vscode.MarkdownString {
  const markdown = new vscode.MarkdownString(undefined, true);
  markdown.baseUri = assetBaseUri;
  markdown.isTrusted = {
    enabledCommands: [
      'kren.copyLastResult',
      'kren.replaceLastResult',
      'kren.showDetails',
      'kren.translateSelection',
      'kren.explainSelection',
      'kren.playPronunciation'
    ]
  };
  markdown.supportHtml = true;

  if (result.providerId === 'merriamWebsterCollegiate' ||
      result.providerId === 'merriamWebsterMedical' ||
      result.providerId === 'merriamWebsterThesaurus') {
    markdown.appendMarkdown(
      '<img src="https://dictionaryapi.com/images/info/branding-guidelines/MWLogo_LightBG_120x120_2x.png" width="50" height="50" alt="Merriam-Webster logo">\n\n'
    );
  }

  if (result.kind === 'thesaurus') {
    renderThesaurus(markdown, result);
  } else if (result.kind === 'grammar') {
    renderGrammarMarkdown(markdown, result);
  } else if (result.kind === 'rewrite') {
    renderRewriteMarkdown(markdown, result);
  } else if (result.kind === 'dictionary' && result.sections?.length) {
    renderMerriamWebsterDictionary(markdown, result);
  } else if (result.kind === 'dictionary') {
    renderDictionary(markdown, result);
  } else {
    const direction = `${languageName(result.sourceLanguage)} → ${languageName(result.targetLanguage)}`;
    markdown.appendMarkdown(`### ${direction}\n\n`);
    markdown.appendMarkdown(`${escapeMarkdown(result.translatedText)}\n\n`);
    if (result.alternatives?.length) {
      markdown.appendMarkdown('**Alternatives**\n\n');
      result.alternatives.slice(0, 3).forEach((alternative) => {
        markdown.appendMarkdown(`- ${escapeMarkdown(alternative)}\n`);
      });
      markdown.appendMarkdown('\n');
    }
    if (result.note) markdown.appendMarkdown(`_Note: ${escapeMarkdown(result.note)}_\n\n`);
  }

  markdown.appendMarkdown(`---\n\nProvider: ${escapeMarkdown(providerName(result.providerId))}\n\n`);
  appendProviderAttributionMarkdown(markdown, result.providerId, Boolean(assetBaseUri));
  if (result.kind === 'dictionary' || result.kind === 'thesaurus') {
    markdown.appendMarkdown(
      '[Translate](command:kren.translateSelection) · ' +
      '[Explain Nuance](command:kren.explainSelection) · '
    );
    markdown.appendMarkdown(
      '[Copy](command:kren.copyLastResult) · ' +
        '[Open Details](command:kren.showDetails)'
    );
    return markdown;
  }
  markdown.appendMarkdown(
    '[Copy](command:kren.copyLastResult) · ' +
      '[Replace Selection](command:kren.replaceLastResult) · ' +
      '[Open Details](command:kren.showDetails)'
  );
  return markdown;
}

function appendProviderAttributionMarkdown(
  markdown: vscode.MarkdownString,
  providerId: string,
  hasAssetBaseUri: boolean
): void {
  if (providerId === 'googleCloudTranslation') {
    if (hasAssetBaseUri) {
      markdown.appendMarkdown(
        '[![Powered by Google Translate](google-translate-attribution.png)](https://translate.google.com)\n\n'
      );
    } else {
      markdown.appendMarkdown('Powered by [Google Translate](https://translate.google.com).\n\n');
    }
    markdown.appendMarkdown(
      '_This service may contain translations powered by Google. Google disclaims warranties related to the translations, including accuracy and reliability._\n\n'
    );
  } else if (providerId === 'koreanBasicDictionary') {
    markdown.appendMarkdown(
      'Source: [Basic Korean Dictionary](https://krdict.korean.go.kr/eng/), National Institute of Korean Language. Text is provided under CC BY-SA.\n\n'
    );
  }
}

export function resultText(result: KrenResult): string {
  if (result.kind === 'translation') return result.translatedText;
  if (result.kind === 'rewrite') return result.variants[0]?.text ?? '';
  if (result.kind === 'grammar') return result.sourceText;
  if (result.kind === 'thesaurus') {
    return uniqueThesaurusWords(result).slice(0, 20).join(', ');
  }
  return result.entries.map((entry) => entry.meaning).join('; ');
}

export function resultDetails(result: KrenResult): string {
  const lines: string[] = [];

  if (result.kind === 'translation') {
    lines.push('Translation', '-----------', result.translatedText);
    if (result.modelId) lines.push('', `Model: ${result.modelId}`);
    if (result.fallbackFromModel) {
      lines.push(`Fallback: ${result.modelId} used after ${result.fallbackFromModel} could not produce a usable result.`);
    }
    if (result.alternatives?.length) {
      lines.push('', 'Alternatives', '------------', ...result.alternatives.map((item) => `- ${item}`));
    }
    if (result.note) lines.push('', 'Note', '----', result.note);
  } else if (result.kind === 'grammar') {
    lines.push(
      'Grammar Check',
      '-------------',
      `Dialect: ${grammarDialectLabel(result.dialect)}`,
      `Issues: ${result.issues.length}`
    );
    if (!result.issues.length) {
      lines.push('', 'No spelling or grammar issues found by Harper.');
    } else {
      result.issues.forEach((issue, index) => {
        lines.push('', `${index + 1}. ${issue.category}: ${issue.original || '(insertion point)'}`);
        lines.push(`   ${issue.message}`);
        issue.suggestions.forEach((suggestion) => lines.push(`   - ${suggestion.label}`));
      });
    }
  } else if (result.kind === 'dictionary') {
    lines.push(formatHeadword(result), '');
    if (result.sections?.length) {
      result.sections.forEach((section, sectionIndex) => {
        const position = result.sections!.length > 1
          ? ` (${sectionIndex + 1} of ${result.sections!.length})`
          : '';
        const partOfSpeech = section.partOfSpeech ? ` — ${section.partOfSpeech}` : '';
        lines.push(`${section.headword}${position}${partOfSpeech}`);
        if (section.pronunciation) lines.push(`Pronunciation: ${section.pronunciation}`);
        if (section.inflections?.length) lines.push(`Forms: ${section.inflections.join('; ')}`);
        section.entries.forEach((entry, entryIndex) => {
          const label = entry.grammaticalLabel ? ` [${entry.grammaticalLabel}]` : '';
          lines.push(`${entry.senseNumber ?? entryIndex + 1}. ${entry.meaning}${label}`);
          entry.examples?.forEach((example) => lines.push(`   Example: ${example}`));
        });
        section.synonymDiscussions?.forEach((discussion) => {
          lines.push('', synonymDiscussionTitle(section.headword, discussion.label));
          lines.push('Merriam-Webster editorial comparison for this sense; not a translation.');
          if (discussion.blocks?.length) {
            discussion.blocks.forEach((block) => lines.push(
              block.kind === 'example' ? `   Example: ${block.text}` : block.text
            ));
          } else {
            lines.push(discussion.text);
            discussion.examples?.forEach((example) => lines.push(`   Example: ${example}`));
          }
          if (discussion.seeAlso?.length) {
            lines.push(`   See also: ${discussion.seeAlso.join(', ')}`);
          }
        });
        lines.push('');
      });
    } else {
      result.entries.forEach((entry, index) => {
        const pos = entry.partOfSpeech ? ` (${entry.partOfSpeech})` : '';
        lines.push(`${index + 1}. ${entry.meaning}${pos}`);
        if (entry.definition) lines.push(`   ${entry.definition}`);
        entry.examples?.forEach((example) => lines.push(`   Example: ${example}`));
      });
    }
    if (result.note) lines.push('', 'Note', '----', result.note);
  } else if (result.kind === 'thesaurus') {
    lines.push(result.headword, '');
    result.sections.forEach((section, sectionIndex) => {
      const partOfSpeech = section.partOfSpeech ? ` — ${section.partOfSpeech}` : '';
      lines.push(`${section.headword}${partOfSpeech}`);
      if (section.pronunciation) lines.push(`Pronunciation: ${section.pronunciation}`);
      section.senses.forEach((sense, senseIndex) => {
        const number = sense.senseNumber ?? String(senseIndex + 1);
        if (sense.definition) lines.push(`${number}. ${sense.definition}`);
        appendThesaurusLine(lines, 'Synonyms', sense.synonyms);
        appendThesaurusLine(lines, 'Near synonyms', sense.nearSynonyms);
        appendThesaurusLine(lines, 'Related words', sense.relatedWords);
        appendThesaurusLine(lines, 'Synonymous phrases', sense.synonymousPhrases);
        appendThesaurusLine(lines, 'Antonyms', sense.antonyms);
        appendThesaurusLine(lines, 'Near antonyms', sense.nearAntonyms);
      });
      if (sectionIndex < result.sections.length - 1) lines.push('');
    });
    if (result.note) lines.push('', 'Note', '----', result.note);
  } else {
    if (result.modelId) lines.push(`Model: ${result.modelId}`);
    if (result.fallbackFromModel) {
      lines.push(`Fallback: ${result.modelId} used after ${result.fallbackFromModel} could not produce a usable result.`);
    }
    if (result.modelId || result.fallbackFromModel) lines.push('');
    lines.push(`Language: ${languageName(result.sourceLanguage)}`);
    if (isEnglishLanguageCode(result.sourceLanguage)) {
      lines.push(`English: ${rewriteEnglishVarietyLabel(result.englishVariety)}`);
    }
    lines.push(`Domain: ${rewriteDomainLabel(result.domain)}`);
    lines.push(`Tone: ${rewriteToneLabel(result.tone)}`);
    lines.push(`Mode: ${rewriteRhetoricalModeLabel(result.rhetoricalMode)}`, '');
    result.variants.forEach((variant, index) => {
      if (index > 0) lines.push('');
      lines.push(variant.label, '-'.repeat(variant.label.length), variant.text);
      if (variant.changeNote) lines.push('', `What changed: ${variant.changeNote}`);
    });
  }
  lines.push(
    '',
    '==============',
    `Direction: ${languageName(result.sourceLanguage)} -> ${languageName(result.targetLanguage)}`,
    `Provider: ${providerName(result.providerId)}`
  );
  if (result.providerId === 'googleCloudTranslation') {
    lines.push(
      'Powered by Google Translate: https://translate.google.com',
      'This service may contain translations powered by Google. Google disclaims warranties related to the translations, including accuracy and reliability.'
    );
  } else if (result.providerId === 'koreanBasicDictionary') {
    lines.push(
      'Source: Basic Korean Dictionary, National Institute of Korean Language (https://krdict.korean.go.kr/eng/). Text is provided under CC BY-SA.'
    );
  }
  lines.push('----------');
  return lines.join('\n');
}

function renderGrammarMarkdown(markdown: vscode.MarkdownString, result: GrammarResult): void {
  markdown.appendMarkdown(`### Grammar Check · ${escapeMarkdown(grammarDialectLabel(result.dialect))}\n\n`);
  if (!result.issues.length) {
    markdown.appendMarkdown('No spelling or grammar issues found by Harper.\n\n');
    return;
  }
  result.issues.forEach((issue, index) => {
    markdown.appendMarkdown(`**${index + 1}. ${escapeMarkdown(issue.category)}** — \`${escapeMarkdown(issue.original || 'insertion point')}\`\n\n`);
    markdown.appendMarkdown(`${escapeMarkdown(issue.message)}\n\n`);
    issue.suggestions.forEach((suggestion) => markdown.appendMarkdown(`- ${escapeMarkdown(suggestion.label)}\n`));
    markdown.appendMarkdown('\n');
  });
}

function grammarDialectLabel(dialect: GrammarResult['dialect']): string {
  if (dialect === 'british') return 'British English';
  if (dialect === 'australian') return 'Australian English';
  if (dialect === 'canadian') return 'Canadian English';
  if (dialect === 'indian') return 'Indian English';
  return 'American English';
}

function renderRewriteMarkdown(markdown: vscode.MarkdownString, result: RewriteResult): void {
  if (result.modelId) {
    const fallback = result.fallbackFromModel
      ? `; fallback from ${escapeMarkdown(result.fallbackFromModel)}`
      : '';
    markdown.appendMarkdown(`_Model: ${escapeMarkdown(result.modelId)}${fallback}_\n\n`);
  }
  markdown.appendMarkdown(
    `_Language: ${escapeMarkdown(languageName(result.sourceLanguage))}; ` +
    (isEnglishLanguageCode(result.sourceLanguage)
      ? `English: ${escapeMarkdown(rewriteEnglishVarietyLabel(result.englishVariety))}; `
      : '') +
    `Domain: ${escapeMarkdown(rewriteDomainLabel(result.domain))}; ` +
    `Tone: ${escapeMarkdown(rewriteToneLabel(result.tone))}; ` +
    `Mode: ${escapeMarkdown(rewriteRhetoricalModeLabel(result.rhetoricalMode))}_\n\n`
  );
  result.variants.forEach((variant) => {
    markdown.appendMarkdown(`### ${escapeMarkdown(variant.label)}\n\n`);
    markdown.appendMarkdown(`${escapeMarkdown(variant.text)}\n\n`);
    if (variant.changeNote) {
      markdown.appendMarkdown(`_What changed: ${escapeMarkdown(variant.changeNote)}_\n\n`);
    }
  });
}

function rewriteDomainLabel(value: RewriteResult['domain']): string {
  if (value === 'academic') return 'Academic';
  if (value === 'technical') return 'Technical';
  if (value === 'business') return 'Business';
  if (value === 'email') return 'Email';
  return 'General';
}

function rewriteEnglishVarietyLabel(value: RewriteResult['englishVariety']): string {
  if (value === 'british') return 'British English';
  if (value === 'australian') return 'Australian English';
  if (value === 'canadian') return 'Canadian English';
  if (value === 'indian') return 'Indian English';
  if (value === 'international') return 'International English';
  return 'American English';
}

function rewriteToneLabel(value: RewriteResult['tone']): string {
  if (value === 'plainLanguage') return 'Plain Language';
  if (value === 'preserveVoice') return 'Preserve My Voice';
  if (value === 'professional') return 'Professional';
  if (value === 'warm') return 'Warm';
  if (value === 'assertive') return 'Assertive';
  if (value === 'cautious') return 'Cautious';
  if (value === 'diplomatic') return 'Diplomatic';
  if (value === 'formal') return 'Formal';
  if (value === 'direct') return 'Direct';
  return 'Neutral';
}

function rewriteRhetoricalModeLabel(value: RewriteResult['rhetoricalMode']): string {
  if (value === 'explain') return 'Explain';
  if (value === 'persuade') return 'Persuade';
  if (value === 'recommend') return 'Recommend';
  if (value === 'constructivelyChallenge') return 'Constructively Challenge';
  return 'Preserve Original';
}

function renderThesaurus(markdown: vscode.MarkdownString, result: ThesaurusResult): void {
  result.sections.forEach((section, sectionIndex) => {
    if (sectionIndex > 0) markdown.appendMarkdown('---\n\n');
    const partOfSpeech = section.partOfSpeech ? ` — *${escapeMarkdown(section.partOfSpeech)}*` : '';
    markdown.appendMarkdown(`### ${escapeMarkdown(section.headword)}${partOfSpeech}\n\n`);
    if (section.pronunciation) {
      const audio = section.audioUrl
        ? ` — [$(play)](${pronunciationCommandUri(section.audioUrl, section.headword)} "Play pronunciation in VS Code")`
        : '';
      markdown.appendMarkdown(`_${escapeMarkdown(section.pronunciation)}_${audio}\n\n`);
    }
    section.senses.forEach((sense, senseIndex) => {
      const number = sense.senseNumber ?? String(senseIndex + 1);
      if (sense.definition) {
        markdown.appendMarkdown(`**${escapeMarkdown(number)}.** ${escapeMarkdown(sense.definition)}\n\n`);
      } else if (section.senses.length > 1) {
        markdown.appendMarkdown(`**Sense ${escapeMarkdown(number)}**\n\n`);
      }
      appendThesaurusMarkdown(markdown, 'Synonyms', sense.synonyms);
      appendThesaurusMarkdown(markdown, 'Near synonyms', sense.nearSynonyms);
      appendThesaurusMarkdown(markdown, 'Related words', sense.relatedWords);
      appendThesaurusMarkdown(markdown, 'Synonymous phrases', sense.synonymousPhrases);
      appendThesaurusMarkdown(markdown, 'Antonyms', sense.antonyms);
      appendThesaurusMarkdown(markdown, 'Near antonyms', sense.nearAntonyms);
    });
  });
  if (result.note) markdown.appendMarkdown(`_Note: ${escapeMarkdown(result.note)}_\n\n`);
}

function appendThesaurusMarkdown(
  markdown: vscode.MarkdownString,
  label: string,
  words: ThesaurusWord[] | undefined
): void {
  if (!words?.length) return;
  markdown.appendMarkdown(`**${label}:** ${words.map(formatThesaurusWordMarkdown).join(', ')}\n\n`);
}

function formatThesaurusWordMarkdown(word: ThesaurusWord): string {
  const labels = word.labels?.length ? ` _(${word.labels.map(escapeMarkdown).join(', ')})_` : '';
  return `${escapeMarkdown(word.word)}${labels}`;
}

function appendThesaurusLine(
  lines: string[],
  label: string,
  words: ThesaurusWord[] | undefined
): void {
  if (!words?.length) return;
  lines.push(`   ${label}: ${words.map(formatThesaurusWordText).join(', ')}`);
}

function formatThesaurusWordText(word: ThesaurusWord): string {
  return word.labels?.length ? `${word.word} (${word.labels.join(', ')})` : word.word;
}

function uniqueThesaurusWords(result: ThesaurusResult): string[] {
  const seen = new Set<string>();
  const words: string[] = [];
  for (const section of result.sections) {
    for (const sense of section.senses) {
      for (const item of sense.synonyms) {
        const key = item.word.toLocaleLowerCase('en-US');
        if (seen.has(key)) continue;
        seen.add(key);
        words.push(item.word);
      }
    }
  }
  return words;
}

function renderDictionary(markdown: vscode.MarkdownString, result: DictionaryResult): void {
  markdown.appendMarkdown(`### ${escapeMarkdown(formatHeadword(result))}\n\n`);
  result.entries.slice(0, 3).forEach((entry, index) => {
    const pos = entry.partOfSpeech ? ` · ${escapeMarkdown(entry.partOfSpeech)}` : '';
    markdown.appendMarkdown(`**${index + 1}. ${escapeMarkdown(entry.meaning)}**${pos}\n\n`);
    if (entry.definition) markdown.appendMarkdown(`${escapeMarkdown(entry.definition)}\n\n`);
    entry.examples?.slice(0, 2).forEach((example) => {
      markdown.appendMarkdown(`> ${escapeMarkdown(example)}\n\n`);
    });
  });
  if (result.note) markdown.appendMarkdown(`_Note: ${escapeMarkdown(result.note)}_\n\n`);
}

function renderMerriamWebsterDictionary(
  markdown: vscode.MarkdownString,
  result: DictionaryResult
): void {
  const sections = result.sections ?? [];
  sections.forEach((section, index) => {
    if (index > 0) markdown.appendMarkdown('---\n\n');
    renderMerriamWebsterSection(markdown, section, index, sections.length);
  });
  if (result.note) markdown.appendMarkdown(`_Note: ${escapeMarkdown(result.note)}_\n\n`);
}

function renderMerriamWebsterSection(
  markdown: vscode.MarkdownString,
  section: DictionarySection,
  index: number,
  sectionCount: number
): void {
  const position = sectionCount > 1
    ? ` \`${section.homograph ?? index + 1} of ${sectionCount}\``
    : '';
  const partOfSpeech = section.partOfSpeech ? ` · *${escapeMarkdown(section.partOfSpeech)}*` : '';
  markdown.appendMarkdown(
    `### ${escapeMarkdown(section.headword)}${position}${partOfSpeech}\n\n`
  );

  if (section.pronunciation) {
    const audio = section.audioUrl
      ? ` · [🔊](${pronunciationCommandUri(section.audioUrl, section.headword)} "Play pronunciation in VS Code")`
      : '';
    markdown.appendMarkdown(`_${escapeMarkdown(section.pronunciation)}_${audio}\n\n`);
  }
  if (section.inflections?.length) {
    markdown.appendMarkdown(`**${section.inflections.map(escapeMarkdown).join('; ')}**\n\n`);
  }

  let previousLabel: string | undefined;
  section.entries.forEach((entry, entryIndex) => {
    if (entry.grammaticalLabel && entry.grammaticalLabel !== previousLabel) {
      markdown.appendMarkdown(`*${escapeMarkdown(entry.grammaticalLabel)}*\n\n`);
      previousLabel = entry.grammaticalLabel;
    }
    const number = entry.senseNumber ?? String(entryIndex + 1);
    markdown.appendMarkdown(`**${escapeMarkdown(number)}**  ${escapeMarkdown(entry.meaning)}\n\n`);
    entry.examples?.forEach((example) => {
      markdown.appendMarkdown(`> ${escapeMarkdown(example)}\n\n`);
    });
  });
  section.synonymDiscussions?.forEach((discussion) => {
    markdown.appendMarkdown(
      `**${escapeMarkdown(synonymDiscussionTitle(section.headword, discussion.label))}**\n\n`
    );
    markdown.appendMarkdown(
      `_Merriam-Webster editorial comparison for this sense; not Cloud Translation._\n\n`
    );
    if (discussion.blocks?.length) {
      discussion.blocks.forEach((block) => markdown.appendMarkdown(
        block.kind === 'example'
          ? `> ${escapeMarkdown(block.text)}\n\n`
          : `${escapeMarkdown(block.text)}\n\n`
      ));
    } else {
      markdown.appendMarkdown(`${escapeMarkdown(discussion.text)}\n\n`);
      discussion.examples?.forEach((example) => {
        markdown.appendMarkdown(`> ${escapeMarkdown(example)}\n\n`);
      });
    }
    if (discussion.seeAlso?.length) {
      markdown.appendMarkdown(
        `_See also: ${discussion.seeAlso.map(escapeMarkdown).join(', ')}_\n\n`
      );
    }
  });
}

function synonymDiscussionTitle(headword: string, label: string | undefined): string {
  return !label || /^synonyms?$/iu.test(label.trim())
    ? `Choose the Right Synonym for ${headword}`
    : label;
}

function pronunciationCommandUri(audioUrl: string, headword: string): string {
  const argumentsJson = encodeURIComponent(JSON.stringify([audioUrl, headword]));
  return `command:kren.playPronunciation?${argumentsJson}`;
}

function formatHeadword(result: DictionaryResult): string {
  return result.pronunciation
    ? `${result.headword} [${result.pronunciation}]`
    : result.headword;
}

function providerName(providerId: string): string {
  return providerNames[providerId] ?? providerId;
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}\[\]()<>#+\-.!|]/gu, '\\$&');
}
