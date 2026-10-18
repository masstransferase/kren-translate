/** Credential setup destinations are owned here, never supplied by the webview. */
export const CREDENTIAL_HELP = {
  cloudflareAccountId: {
    label: 'Cloudflare account ID',
    sentence: "For Cloudflare pictures, dictation, and models in LLM ROUTING. Sign in to the Cloudflare dashboard and copy the Account ID from your account's home page.",
    linkText: 'Cloudflare documentation',
    url: 'https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/'
  },
  cloudflareApiToken: {
    label: 'Cloudflare API token',
    sentence: 'For Cloudflare pictures, dictation, and models in LLM ROUTING. Create an API token with Workers AI permission under My Profile, API Tokens.',
    linkText: 'Cloudflare dashboard',
    url: 'https://dash.cloudflare.com/profile/api-tokens'
  },
  geminiDefault: {
    label: 'Gemini Free Tier',
    sentence: 'For Gemini features on the free tier. Create a key in Google AI Studio, API keys.',
    linkText: 'Google AI Studio',
    url: 'https://aistudio.google.com/apikey'
  },
  geminiAlternate: {
    label: 'Gemini Paid',
    sentence: 'For Gemini features that need billing, such as situation pictures. Create a key in Google AI Studio for a project with billing turned on.',
    linkText: 'Google AI Studio',
    url: 'https://aistudio.google.com/apikey'
  },
  googleCloudTextToSpeech: {
    label: 'Google Cloud Text-to-Speech',
    sentence: 'For Chirp voices. In the Google Cloud console, enable the Text-to-Speech API for your project, then create an API key under Credentials.',
    linkText: 'Google Cloud console',
    url: 'https://console.cloud.google.com/apis/credentials'
  },
  googleCloudTranslation: {
    label: 'Google Cloud Translation',
    sentence: 'For Cloud Translation and unmatched English phrase translation. In the Google Cloud console, enable the Cloud Translation API for your project, then create an API key under Credentials.',
    linkText: 'Google Cloud console',
    url: 'https://console.cloud.google.com/apis/credentials'
  },
  openai: {
    label: 'OpenAI',
    sentence: 'For OpenAI models in LLM ROUTING. Create a key on the OpenAI platform, API keys.',
    linkText: 'OpenAI platform',
    url: 'https://platform.openai.com/settings/organization/api-keys'
  },
  groq: {
    label: 'Groq',
    sentence: 'For Groq models in LLM ROUTING. Create a key in the Groq Console, API Keys.',
    linkText: 'Groq Console',
    url: 'https://console.groq.com/keys'
  },
  anthropic: {
    label: 'Anthropic',
    sentence: 'For Claude models in LLM ROUTING. Create a key in the Claude Console, API keys.',
    linkText: 'Claude Console',
    url: 'https://platform.claude.com/settings/keys'
  },
  merriamWebsterCollegiate: {
    label: 'Merriam-Webster Collegiate',
    sentence: 'For English Dictionary and combined User Dictionary reference lookup. Register at the Merriam-Webster Dictionary API site and request a Collegiate Dictionary key.',
    linkText: 'Merriam-Webster Dictionary API',
    url: 'https://dictionaryapi.com/'
  },
  merriamWebsterThesaurus: {
    label: 'Merriam-Webster Thesaurus',
    sentence: 'For Synonyms. Register at the Merriam-Webster Dictionary API site and request a Collegiate Thesaurus key.',
    linkText: 'Merriam-Webster Dictionary API',
    url: 'https://dictionaryapi.com/'
  },
  merriamWebsterMedical: {
    label: 'Merriam-Webster Medical',
    sentence: 'For Medical Dictionary. Register at the Merriam-Webster Dictionary API site and request a Medical Dictionary key.',
    linkText: 'Merriam-Webster Dictionary API',
    url: 'https://dictionaryapi.com/'
  },
  koreanDictionary: {
    label: 'Korean Dictionary',
    sentence: 'For Korean Dictionary. Sign in to the Korean Basic Dictionary site and register for an Open API key.',
    linkText: 'Korean Basic Dictionary',
    url: 'https://krdict.korean.go.kr/eng/openApi/openApiRegister'
  }
} as const;

export type CredentialHelpId = keyof typeof CREDENTIAL_HELP;

export function credentialHelpFor(id: string): (typeof CREDENTIAL_HELP)[CredentialHelpId] | undefined {
  return Object.hasOwn(CREDENTIAL_HELP, id) ? CREDENTIAL_HELP[id as CredentialHelpId] : undefined;
}
