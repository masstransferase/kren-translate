# KREN User Guide

This guide applies to KREN 2.0.0.

API means application programming interface; LLM means large language model. Bold names in the steps are control labels or Command Palette commands; speaker, pencil, and trash icons are identified by their position when their accessible labels include the current term.

## Set up

Install KREN and unlock the online features you want.

1. Use VS Code Desktop 1.106 or later. Install KREN, or run **Extensions: Install from VSIX...**, select your package, and reload VS Code.
2. Run **KREN: Show KREN Secondary Sidebar**. Open the **KREN menu**, then **Credentials**.
3. Choose **Set key** beside the provider you need and enter your developer API key in the VS Code prompt. Use the table below to choose keys. Each row's information icon tells where to get that key.
4. Open the feature's settings group. Set its language and provider; for model features, open **LLM ROUTING** and choose **Provider**, **Model**, and **Thinking level**.
5. Select editor text and right-click a KREN action, or run its Command Palette command. For text copied from another panel, click **KREN** in the status bar, check the clipboard preview, and choose an action.

The Start Page names the missing key beside disabled actions. Offline Grammar Check, saved User Dictionary browsing/editing/import/export, and local Windows reading need no key. Generated entries and tutor content need a model key.

| Key | Unlocks |
| --- | --- |
| Merriam-Webster Collegiate API key | English Dictionary and combined User Dictionary reference lookup |
| Merriam-Webster Collegiate Thesaurus API key | Synonyms |
| Merriam-Webster Medical Dictionary API key | Medical Dictionary |
| Korean Basic Dictionary Open API key | Korean Dictionary |
| Google Cloud Translation Basic v2 key | Cloud Translation and unmatched English phrase translation |
| Gemini, OpenAI API, or Anthropic API key | Explain Nuance, Rewrite, Smart Grammar Check, generated User Dictionary entries, AI English Tutor through the selected route |
| Gemini Free Tier or Gemini Paid API key | LLM Translation, Gemini dictation (Free Tier), Live replies, Gemini situation pictures (Paid) |
| Cloudflare account ID and API token | Cloudflare FLUX.1 schnell situation pictures and Whisper dictation |

You can configure two of the three Merriam-Webster references: Collegiate Dictionary, Collegiate Thesaurus, Medical Dictionary. The public build refuses a third stored key; remove one with Delete key first. KREN includes no shared credentials. Consumer subscriptions do not automatically include developer API access or credits.

For Cloudflare, use both Set rows in **KREN menu**, **Credentials** for the account ID and API token. Choose **Cloudflare free models** in **Picture Provider** in tutor **VOICE & MODEL**, then choose **FLUX.1 schnell** or **FLUX.2 klein 4B** in **Image Model**, and choose **Cloudflare** or **Auto** in **Speech provider** in tutor **VOICE & MODEL**. Auto chooses Handy, Cloudflare, Groq, then Gemini Free Tier. Cloudflare pictures and Whisper dictation share the account's free daily allowance of 10,000 neurons a day. A 1024 by 1024 FLUX.1 schnell picture used about 173 neurons in a test on 2026-10-10, roughly 57 pictures a day before dictation or other account use; Cloudflare does not report FLUX.2 klein 4B's usage. Continuation pictures from FLUX may not keep the same people.

## Check for updates

Check the system dependencies, model names, and voice names that KREN cannot update with its own release.

1. Open the **KREN menu** and choose its last item, **Check for updates**, after **Settings**.
2. Read the status, found version or state, expected version or state, and explanation for Python, edge-tts, optional Handy, and VS Code. **Check again** refreshes the results. Unknown means the check failed or timed out.
3. For missing or outdated edge-tts, choose **Update**. Confirm the displayed command, which runs the Python in `kren.readAloud.edgePythonCommand` with `-m pip install -U edge-tts`. KREN shows progress and checks again afterward. A failed install shows and logs only pip's last error line, with URLs and credential prefixes removed and the line capped at 200 characters. Restricted Mode does not run the configured Python and offers no Update action.
4. For missing Python, set `kren.readAloud.edgePythonCommand` in VS Code Settings to the installed interpreter. Update VS Code through its Help menu when needed. Handy is optional and supports local tutor dictation.
5. Read the **Models** and **Voices** groups below **System**. The menu check asks providers with stored keys for their public model lists, and Google Cloud Text-to-Speech for its en-US voice list. It sends the key only in the provider's authentication header, with no text. Edge voice discovery uses the configured Python without a key. "No key stored, not checked" means that provider was skipped. Cloudflare is not checked because KREN has no model lister.
6. A name no longer offered is marked "update", naming the feature and model or voice. Choose **Open LLM ROUTING**, **Open TUTOR VOICE**, or **Open Read Aloud voice settings** to review that feature's choices. Smart Grammar shares User Dictionary's routing. Stored choices and code defaults are checked, including inactive choices and the tutor's fallback; KREN does not replace them automatically.

**Updates available** appears beside Home on the Start page when the latest check found missing or outdated edge-tts, Python, or VS Code, or a menu check found a model or voice no longer offered. Select it to open the results; it disappears after a later check finds no required updates. Daily checks and the re-check after Update preserve model and voice result cards within the session, and a failed provider lookup preserves that provider's unresolved notice. After a restart, only statuses remain; a model or voice notice says "Choose Check again for details." Missing Handy alone does not show the notice.

KREN silently checks system dependencies once a day after startup by default. It never checks models or voices automatically. In VS Code Settings, turn off `kren.updates.dailyCheck` to disable it. The daily check sends at most one anonymous request to pypi.org for edge-tts's public version information, with no text, key, or identifier. Only the check date and result statuses are saved. The menu item works even when daily checks are off.

## Look up a word

Find definitions, related words, or Korean headword explanations.

1. Select an English word or short expression, or one Korean headword.
2. Run **KREN: English Dictionary Search**, **KREN: Synonyms Search**, **KREN: Medical Dictionary Search**, or **KREN: Korean Dictionary Search**. The Start Page buttons are **English Dictionary**, **Synonyms**, **Medical Dictionary**, and **Korean Dictionary**.
3. Read the senses and examples. Use the pronunciation speaker when available, or **Open full details** for plain text.
4. After visiting another panel page, use **Back to result** to return without requesting it again.

English and Medical entries retain numbered senses; Synonyms groups words by sense. Korean results credit the Basic Korean Dictionary and National Institute of Korean Language under CC BY-SA. Dictionary results cannot replace editor text. Medical entries define terms and provide no diagnosis.

## Translate

Turn submitted text into your chosen output language.

1. Open **Settings**, **Translation**. Set **Translation provider** and **Output language**. Choose **Google Cloud Translation** or **LLM** for the selected LLM route.
2. Select or copy text and run **KREN: Translate Selection**, or choose **Translation** on the Start Page.
3. Read the result, then use its copy icon or replace icon when the original editor range is available.

Cloud Translation detects the input language. Model translation also uses the visible language and Domain settings. The default shortcut is Ctrl+Alt+K on Windows/Linux or Cmd+Alt+K on macOS.

## Explain Nuance

Ask for meaning, connotation, register, or ambiguity.

1. Open **Settings**, **Explain Meaning or Nuance**. Set **Explanation language** and the provider in **LLM ROUTING**.
2. Select or copy the expression or passage. Run **KREN: Explain Meaning or Nuance**, or choose **Explain Nuance** on the Start Page.
3. Read the explanation; choose **Open full details** for plain text.

The result explains exactly the submitted text. Explicitly select any context you want explained.

## Smart Grammar Check

Review English grammar and choose the corrections to keep.

1. Open **Settings**, **Grammar Check**. Set **Input language** and turn **Smart Grammar Check** on for the model pass, or off for offline Harper only.
2. Select or copy a passage and run **KREN: Grammar Check**. The Start Page says **Smart Grammar Check** when its shared model route is ready, otherwise **Grammar Check**.
3. Choose a suggestion or **Keep original** for each finding. Edit the corrected passage if needed, then use the replace or copy icon below it.
4. For one editor underline, open **Quick Fix...**. To dismiss the displayed check, use **Ignore all**.

The document changes only after your replacement action. Clipboard checks offer copying. Local findings remain if the model fails; automatic paragraph checking stays local.

## Rewrite

Correct wording or apply your chosen writing style.

1. Open **Settings**, **Rewrite Text**. Choose its provider in **LLM ROUTING**. For a styled rewrite, set **Output language**, **Domain**, **Formality**, **Voice**, **Stance**, **Length**, **Perspective**, and **Rhetorical mode** in their groups.
2. Select or copy text. Run **KREN: Rewrite Text: Minimal Rewrite** for source-language corrections, **KREN: Rewrite Text: Full Rewrite** for your style choices, or **KREN: Rewrite Text: Both Variants** to compare.
3. For a single result in the panel, turn **Copy result to clipboard** off before running. With it on, a single variant goes directly to the clipboard.
4. Read the variant, then copy it or replace the eligible selection. Use its speaker and stop icons when **Show Read Aloud controls** is on.

Both Variants always opens the comparison panel. Minimal Rewrite keeps the source language; Full Rewrite can use your chosen output language.

## Read Aloud

Hear a cleaned speech copy without changing the source.

1. On a local Windows extension host, open **Settings**, **Read Aloud (Windows)**.
2. Set **Speech source** to **Local Windows (offline)**, **Microsoft Edge Online**, or **Google Cloud Chirp 3 HD**. For Edge, install `edge-tts` with `python -m pip install edge-tts` and set **Python command** if needed. For Chirp, set the Google Cloud Text-to-Speech key in **KREN menu**, **Credentials**. If that slot is empty, KREN uses the Cloud Translation key. Enable the Text-to-Speech API and billing in that key's Google Cloud project.
3. Choose **Language/Region**, voice, speed, and **Volume**. The default Edge voice is en-US-ChristopherNeural; Language/Region stays Auto-detect. Chirp uses **Chirp voice**, default Callirrhoe, and **Reading speed**, where zero percent maps to the natural rate, 1.0, limited to 0.25 through 2.0. Auto-detect resolves the language in the same way as Edge Online. A voice may be unavailable for a particular locale. Use the voice preview speaker to test the selected source.
4. Select text and run **KREN: Read Aloud**. Accept Edge's first-use disclosure if prompted. Run **KREN: Stop Read Aloud** to stop. Any panel navigation (the KREN menu, Home, Settings, AI English Tutor, User Dictionary, User Manual, Back to result) also stops it.

KREN removes common Markdown and citation artifacts from the speech copy. Editor reading needs local Windows; dictionary pronunciation can use the panel player on other hosts.

Chirp sends only the cleaned speech copy to Google Cloud Text-to-Speech. Audio plays through a hidden native Windows player, whether the panel is open or closed. KREN deletes each temporary MP3 after playback or Stop. The player starts with the utterance, reuses its process for later sentences, and exits after two minutes idle. If Chirp has no key, an unsupported locale, an unavailable voice and locale pair, or a synthesis failure after one retry, KREN tries Edge Online and then Local Windows. Playback failures go straight to fallback without requesting Google again. Selected Edge Online also falls through to Local Windows when it fails. One notice per VS Code session names the cause and the voice now used. Read Aloud has its own settings and never reads or writes the tutor's voice settings.

## User Dictionary

Keep an editable local glossary and back it up.

### Add an entry

Create a personal entry from an expression.

1. Open **Settings**, **User Dictionary**. Leave **Enable User Dictionary** on and choose **Default capture mode**: **LLM Only** or **Merriam-Webster + LLM**. Combined mode also needs the Collegiate key.
2. Select an expression and run **KREN: Add to User Dictionary**.
3. Review and edit the draft. Choose **Save personal entry**, **Regenerate** for another draft, or **Cancel** to discard it.
4. For an existing expression, choose **Open existing** to read it or **Update existing** to edit it.

Nothing is stored until you save. Combined capture shows the independent live reference beside the draft; saving retains personal wording and reference identifiers, not the publisher's wording.

### Use Smart Word Capture

Record the meaning used where you found an expression.

1. In **Settings**, **User Dictionary**, leave **Smart Word Capture** on, or turn it off to capture the expression alone.
2. Select an expression inside an editor sentence and run **KREN: Add to User Dictionary**.
3. Review **In the captured text** and **All meanings**, then choose **Save personal entry**.

The entry keeps all meanings plus the available context and relevant meaning. Ambiguous context is identified without guessing; a standalone word has no context box.

### Edit an entry

Correct your stored personal fields.

1. Open **KREN menu**, **User Dictionary**, or run **KREN: Open User Dictionary**.
2. Choose a term, then the pencil icon directly under it.
3. Edit its fields and senses. Choose **Save personal entry**, or **Cancel** to keep the stored version.

Changes appear in entry details. Canceling or failing regeneration preserves the previous draft and unsaved edits.

### Search and filter

Find saved expressions without regenerating them.

1. Open **User Dictionary** and type in **Search term, aliases, meanings, tags, and collections**.
2. Use **Filter by language**, **Filter by collection**, **Filter by entry type**, **Filter by capture mode**, or **Filter by source availability** to narrow the list.
3. Choose a term to read it; select checkboxes for later export or deletion.

The list shows matching entries and counts. Search, filters, and selection make no provider request.

### Export and import

Back up entries or restore a reviewed file.

1. In **Settings**, **User Dictionary**, choose **Export JSON** for a lossless backup or **Export Markdown** for a readable, lossy file. In the list, select entries for **Export selected JSON** or **Export selected Markdown**.
2. Choose **Import**, select the file, and read **Import preview**, including duplicates and invalid records.
3. Choose **Merge, keep existing**, **Merge, replace duplicates**, or **Replace all** after reviewing the proposed changes; choose **Cancel** to keep the dictionary as it is.

Invalid records and internal duplicates block applying the import. Storage shows the local location; preserve a corrupt `entries.json` before repair and import a valid version 1 JSON backup.

### Purge entries

Remove a reviewed set of entries.

1. Open **Settings**, **User Dictionary**, and choose **Entries to purge**. Choose **Remove all entries** only to empty the dictionary.
2. Choose **Preview purge** and read the count and terms.
3. Use the preview's trash icon and confirm; Remove all entries requires typed confirmation. Choose **Cancel** to keep the entries.

Confirmation deletes exactly the previewed entries. Age comes from the last edit; viewing does not refresh it.

## AI English Tutor

KREN uses Fast steps for hints, conversation replies and Ask, and Thorough steps for lessons, practice, reviews, corrections and diagnosis. A Fast step moves to Thorough once when validation fails, learner input exceeds 40 words, the transcript exceeds 10 turns, or you ask again. In Settings, Usage, Switch to the next provider is on by default: if a daily or monthly limit is used up, the same submitted text goes to the next provider with stored credentials in your order until local midnight. If Gemini remains overloaded after automatic retries, KREN uses the next provider with stored credentials for that request and names both providers. The next request tries Gemini again. Per-minute limits keep their usual handling; Live and pictures stay with their selected provider. Failed language-model attempts log safe status and reason codes after their usage line, without provider messages or submitted text. Failures appear in a card or an in-panel message, including while an operation is busy.

Build a lesson, practice its patterns, and use them in conversation.

### Build a lesson

Choose learning targets or ask a lesson question.

1. Open **KREN menu**, **AI English Tutor**, then **LEARNING MAP** if folded.
2. Browse the four dropdowns, or type target names and use **Find targets**. Use **Primary** or **Support** on the **Selected targets** heading line. Two or more Supports may come from the same Cluster.
3. For a question-led lesson, turn **Use question without learning-map targets** on. Type in **Search target names or type a question** and choose **Ask or analyze text**. Use **Edit prepared prompt** to adjust the teaching objective.
4. In **LESSON**, choose **Setting** to open **LESSON SETTING**, scroll it into view, and focus its summary. Set **Number of examples**, **Learner level**, **Lesson mode**, and **Practice item count**, plus any style choices.
5. Choose **Draft** below the lesson settings. After drafting, the button reads **Redraft**. Use **Cancel** in the waiting overlay to stop a request.

The lesson shows rules and numbered examples; configuration sections fold to reveal it. An unavailable Draft explains which target or question is missing.

### Read the lesson

View every example before practicing.

1. Read the rules and first example, then use **Next** and **Back** beneath the example to view every current example.
2. Use **Play**, **Dictionary**, **Translate**, or **Ask** beside the example. Submit the drawer's action to make a request.
3. Open **COMMON ERRORS** for contrasts. Choose **Practice now** in the action row below the example controls and before COMMON ERRORS once all examples have been viewed.

Examples show target explanations. Target words in conversation balloons are underlined in the theme's link color; Live matching can miss abstract grammar or inflected forms.

### Practice

Write and review answers for correctness and naturalness.

1. Read the prompt and type a nonblank answer, or use the microphone and press again to stop dictation. While Handy listens, the microphone becomes a pulsing Pause button; press Pause to stop and restore the microphone.
2. Before review, choose **Hint** for guidance tied to a numbered lesson example without the answer.
3. Choose **Next** to continue answering; use **Back** to revisit. Unanswered items cannot be skipped.
4. On the last item, choose **Review all** once every item has a nonblank answer. Review all is disabled until every item is answered and after all current reviews are saved. Editing an answer marks its review out of date and enables Review all again for only changed items. Review all sends one request for all pending answers and retries an invalid review once by itself. **Cancel review** keeps saved reviews; retry reviews only the remaining items.
5. Read marked spans and corrections. Choose **Ask** about a reviewed item. Once every review is saved, use **Next** on the last item for results.
6. Use the counted review buttons to revisit results or the counted diagnostics button for analysis. Choose **Practice again** on the lesson to replace a completed set.

Answers and reviews remain between items. Review all completes practice; errors include unnatural phrasing. For a gap, each review checks the completed sentence with your answer inserted. One blank can stand for one or more words.

### Hold a conversation

Practice an exchange in a situation or from a completed lesson.

1. Open **CONVERSATION**, **MODE**. Choose **Source**: **A situation**, **The lesson**, **Anything**, or **Speak and rephrase**. For The lesson, view every current example and save every current practice item's review first.
2. Choose **Situation**, including **Let KREN choose** or **My own situation**. Set **Swap roles**, **Who starts**, **Register**, and **Correction**.
3. Open **ADVANCED**. Set **Replies** to **Standard** or **Live (Gemini)**. Live needs the selected Gemini profile's key and a live-capable Live Model in VOICE & MODEL; the tutor text Provider can stay as it is.
4. Choose **Situation picture**: **None**, **Intro Only**, **Switching**, or **Gradually Entering**. Adjust **Picture transparency** and **Balloon transparency** when pictures are enabled. With Gemini chosen, situation pictures need a Gemini Paid API key with billing enabled; the default image model costs about US$0.03 per picture and a conversation makes at most 10.
5. Choose **Start** and read or hear the scene. The microphone stays closed. **Demo** reads both roles without recording you; its Stop stays available during speech.
6. Use the single microphone inside the chat in Standard and Live. Press it to begin and again to finish speaking; each turn is sent when you stop. Handy shows a pulsing Pause button while listening. Press the microphone once to start a Live turn and again to finish it, from the next conversation. The lower row keeps speaker, Hint and Skip where offered, Replay, and Stop. There is no conversation text box or Send setting.
7. Choose **Hint** for reply guidance on demand. In ADVANCED, **Prepare hints in advance** is off by default; turning it on uses one extra request per turn so hints open instantly. Read corrections under your turn; use **Why?** or **Ask about this** for explanations. **When you stop** is the Live coaching default and delivers corrections at Stop. **As you go** uses one coaching request per Live turn. Stop sends the deferred corrections; the take-home card waits for **Review now**.
8. Choose **Stop conversation** at an available turn boundary. After at least one sent or spoken learner answer, choose **Review now** to read **TAKE-HOME** below the transcript: "Say it naturally" lists better ways to say a sentence you used, "Learning targets" names learning-map areas to practice next, "Pattern to keep" and "Done well" show what to reuse, and "Try next time" gives one line you could say in your assigned role. Spoken turns get no advice on capitalization or punctuation; KREN shows them with a capital at the start, a capital "I", and a final period or question mark, without changing their words. **Voice** and **Model**, beside **Review now** and beside the LESSON row's **Reset**, open **TUTOR VOICE** and **LLM ROUTING**. **Retry** repeats failed card generation. **Back to chat** resumes with the microphone closed; **Start new** clears the exchange and returns to setup.
9. After **Review now**, choose **More details** to open the diagnostic report; it needs five completed turns, stops the take-home reading, and scrolls on its own. **Back to chat** and **Stop conversation** again keep the card and the report unless you answered again. In the report, **Apply** prepares a new lesson direction and editable prompt; **Back to tutor** keeps the report without applying it.
10. Choose **Speak and rephrase** for a speaking coach. Press **Start** and say anything in English. KREN opens with a local invitation, then shows and speaks one coaching paragraph of two to four sentences about your expression. It judges the wording, gives the fixed form first when needed, and weaves natural ways to say it into the paragraph with brief reasons. Every expression of at least two words inside double quotes is bold and blue, including punctuation just before the closing quote. A quoted single word stays plain. KREN coaches questions too, without answering them or asking anything back. Replay speaks the whole paragraph. There is no feedback block under your balloon; the structured details stay available to Review now and More details. Situation, Swap roles, Who starts, Correction, Reply length, Situation picture, Picture style, and Picture transparency show "Not used in Speak and rephrase." Their choices return with another Source. Register, Replies, and VOICE & MODEL stay available. Hint and Demo are unavailable.

Choose **Cloudflare free models** under **Picture Provider** in **VOICE & MODEL** to use Cloudflare instead, then choose **FLUX.1 schnell** or **FLUX.2 klein 4B** in **Image Model**. The scene text, plus recent turns for later pictures, goes to Cloudflare Workers AI; the previous picture is never sent. Cloudflare Whisper dictation records in memory and sends one WAV audio clip to Cloudflare when you stop. Cloudflare pictures and Whisper dictation share the account's free daily allowance of 10,000 neurons a day. A 1024 by 1024 FLUX.1 schnell picture used about 173 neurons in a test on 2026-10-10, roughly 57 pictures a day before dictation or other account use; Cloudflare does not report FLUX.2 klein 4B's usage. Continuation pictures from FLUX may not keep the same people.

An unfinished lesson source shows “Finish the lesson and its practice first.” and restores the previous source. In ADVANCED, Picture style chooses Realistic or Illustrated from the next picture and is disabled when Situation picture is None. Register, Correction, and Replies are disabled while a conversation is active. With **CONVERSATION**, **ADVANCED**, **Take-home card** on, TAKE-HOME teaches with Say it naturally, Learning targets, Pattern to keep, Done well, and Try next time; diagnosis is separate. Stopping without a committed learner answer, including a Demo, makes no take-home request or card. Skipped and withheld turns do not count. The in-chat microphone and Stop are available at each learner turn in Standard and Live, including when Situation picture is None.

### Change voice and model

Choose tutor playback and model routes.

1. Open **VOICE & MODEL** below CONVERSATION, then **TUTOR VOICE**. Set **Speech Source**, voice, speed, and **Volume**. Edge and Gemini offer **Female Default** and **Male Default**; **Live Voice** has **Preview**.
2. Open **LLM ROUTING**. Choose **Provider**, **Gemini Profile**, **Thorough model**, and **Thinking Level**; set **Fallback Tutor Model** if fallback is enabled.
3. Choose **Fast model**, **Live Model**, and **Image Model** separately. Use **Refresh models** to update lists. For an unlisted identifier, choose **Custom model identifier**, type it, and choose **Add model**.
4. In conversation **ADVANCED**, use **Pause before reply** below **Microphone sensitivity** to set the Live pause. Set **Microphone close wait** for releasing the device, and **Live transcription language** to **English** or **Automatic**. Changes apply from the next **Start** or **Back to chat**.

**Google Cloud Chirp 3 HD** is the default Speech Source for Standard replies, lessons, practice, and take-home reading. It uses the **Gemini Live and Chirp 3 HD Voice Female Default** and **Male Default** in en-US. Reading Speed maps 0% to 1.0, -25% to 0.75, and +25% to 1.25; Volume controls playback. In Live, replies still use Gemini Live, while take-home reading, learner Replay, Demo speech, and voice preview use Chirp without another Live session. Stop, Reset, leaving the tutor, or a new utterance cancels pending synthesis and playback. Chirp uses temporary MP3 files that KREN deletes after playback or Stop.

Open **KREN menu, Credentials** and set the **Google Cloud Text-to-Speech** key, or use the stored Cloud Translation key when the separate slot is empty. Use **Test** on that row to synthesize and play a short sentence with the female choice. Enable **Cloud Text-to-Speech API** and billing in that Google Cloud project, and allow the key to use it. Usage is billed to your project after any free allowance; KREN states no allowance figure. A missing key or service failure shows one notice per conversation and falls back to the gender-matched tutor Edge voice for that utterance. If Edge Online also fails, the tutor Local Windows voice reads the remaining text. The notice names the failed source and the voice KREN used; later failures in the same conversation are logged. No response or HTTP 429, 500, or 503 retries once after one second. Test and the speech log name the failure stage: no response, unreadable audio, native playback with its failure cause, or HTTP status with Google status and reason codes. Google error message text is never shown or logged. **Requests today** lists `google-tts`, `chirp3-hd`, requests, and characters.

Gemini Live and Chirp 3 HD Voice defaults are Callirrhoe for female and Enceladus for male. When the character hands over to someone new, the newcomer speaks in a different preset voice of their gender, and earlier turns replay in the voice that said them; Local Windows has only Zira and David, so a newcomer there may share a voice. With the situation picture on, KREN draws a new picture with the newcomer. Tutor playback is separate from editor reading. Live replies use Gemini audio with the stored Gemini profile key, whatever the LLM ROUTING provider. Edge and Windows stay silent while a Live session is active. Without a Gemini key or after a Live failure, KREN explains the fallback and speaks Standard replies with the chosen Speech Source. Automatic restores provider detection; English supplies an English expectation. A Live-only ordinary Tutor Model is refused with the setting to change.

With Standard replies and the speaker on, the situation intro appears and is read to the end first. Then dots appear in the chat until the first KREN line starts playing, when its text appears. The in-chat microphone and Stop appear when that line finishes, so you can answer. After you send a turn, dots remain until the reply's voice starts, its text appears with its voice, and the controls return when speech ends. If you start first, the controls appear after the intro. With the speaker off, text and controls appear immediately. Failed or fallback speech reveals the affected line, and canceled or stalled speech releases the controls. Situation pictures appear when ready without advancing speech.

Every conversation turn is sent when you stop speaking. The in-chat microphone owns its listening state and remains available to finish a recording. Handy delivers its recognized words directly to the learner balloon. A saved **With the Send button** preference loads as automatic speech submission.

Chirp requests speech by sentence, joining short sentences so a request has about 40 characters or more when the line permits it. It starts the first sentence and requests the next while that sentence plays, keeping their order. Each sentence retries synthesis once after about one second for no response, unreadable audio, or an HTTP error other than 400, 401, and 403, then uses Edge Online for the remaining text. Native playback failure uses Edge Online immediately and never re-synthesizes. If Edge Online is unavailable, Local Windows reads that same remaining text with the tutor voice settings. At most one speech notice appears per conversation; later failures go to the speech log. Missing credentials and HTTP 400, 401, and 403 go directly to the fallback. Stop cancels pending requests and playback. The speech log reports the time to the first Chirp audio once per line. Edge Online and Local Windows read the whole line. Conversation openings resolve named roles, including Roles swapped, and later requests keep those assignments.

For stronger replies, leave Fast model empty in LLM ROUTING; every fast step then uses the Thorough model.

## Light and dark view

Choose a palette or follow the editor theme.

1. Press the theme switch between **Settings** and **KREN menu** to change all open panels between light and dark.
2. Open **Settings**, **Display**, and set **Panel theme** to **Follow VS Code**, **Light**, or **Dark**.

KREN remembers the choice. Follow VS Code restores matching to the editor.

## Reset

Choose the reset covering your intended work or settings.

1. In **Settings**, **Usage**, choose **Default Setting** to restore defaults while keeping keys, consent, usage, and grammar vocabulary. In the VS Code confirmation dialogs, choose Continue, then Restore Defaults after reading the setting count.
2. Choose **Reset KREN** for settings and credentials. Read both confirmations, including the key count. It also clears consent, the Cloud Translation ledger, and grammar vocabulary; User Dictionary entries remain.
3. Use the master **Reset** beside the tutor page title and gear. In the VS Code confirmation dialog, choose Reset panel to keep model, microphone, and voice settings, or Reset everything to restore every tutor-owned setting too. Cancel keeps the work. On first open and after Reset everything, LEARNING MAP is unfolded and every other tutor section is folded.
4. Use **Reset** on the LESSON row to clear only its drafted lesson and practice; use **Reset** beside Start and Demo in MODE to restore conversation preferences.
5. Read the tutor reset information dialog and choose OK.

Master Reset clears targets, question, lesson, practice, conversation, report, and prompt; returns all four learning-map dropdowns to Select an option; and folds LESSON SETTING, MODE, and VOICE & MODEL. Lesson Reset keeps targets, question, prompt, and conversation. Reset confirmation is also announced to screen readers.

Questions with choices and modal confirmations appear in VS Code's own dialog. Escape cancels a confirmation. Status popups, including busy spinners, failures, and provider-switch notices, stay in the KREN panel. If a panel warning or error notice cannot be displayed, KREN shows it in VS Code within 1.5 seconds. Find leaves the panel available while a choice is pending. Reset, a newer search, or a map selection retires the old Find choices.

## Troubleshooting

Choose the next action from your symptom.

### No key

Enable the selected provider.

1. Read the disabled action's reason. Open **KREN menu**, **Credentials**, and choose **Set key** on that provider's row.
2. Check the feature's **LLM ROUTING** and **Gemini Profile** if it remains unavailable.

Keys update availability immediately; offline Grammar Check stays available.

### Quota used up

Check usage before another request.

1. For Cloud Translation, open **KREN menu**, **Credentials**, and choose **Usage Check**.
2. Check provider account quota and billing. Wait for its reset or adjust the authorized quota before submitting again.

Failures never display credentials. Clearing the local ledger does not change billing or justify bypassing the safety ceiling.

### Pictures paused

Continue chatting while repairing picture access.

1. Read the picture's failure reason. For Cloudflare, check both credential rows and the account's daily allowance. For Gemini, check Gemini access and **Image Model** in **VOICE & MODEL**, **LLM ROUTING**.
2. Continue without pictures or select **None** in **Situation picture**.
3. After resolving the cause, choose **Start new** for a fresh conversation.

Cloudflare daily-allowance failures pause pictures while the conversation continues. Missing Cloudflare credentials require both the account ID and API token in KREN menu, Credentials. Pictures and dictation draw on the same daily allowance.

Two consecutive failures pause pictures. Free-tier or zero-limit quota failures explain that billing is required; other quota failures explain that Google refused the request and billing may be needed. With Gemini chosen, situation pictures need a Gemini Paid API key with billing enabled; the default image model costs about US$0.03 per picture and a conversation makes at most 10.

### Microphone unavailable

Restore recording access or type instead.

1. Read the microphone tooltip and check operating system permissions and the input device.
2. Live needs the selected Gemini profile's key and a live-capable Live Model in VOICE & MODEL; the tutor text Provider can stay as it is. For Gemini dictation, check its key. For Cloudflare dictation, check both Cloudflare credentials and the shared daily allowance.
3. Before the next exchange, choose **Standard** in **Replies** to use dictation with the in-chat microphone. Leave and reopen the tutor before restarting stuck capture.

Leaving stops capture, Live, and pending speech while keeping drafts. Editor reading needs a local Windows extension host, and is unavailable in WSL, SSH, Dev Containers, Codespaces, and other remote hosts.

## Reference

### What leaves the machine

| Feature | Destination and content |
| --- | --- |
| English, Synonyms, Medical | Exact word or expression to the respective Merriam-Webster API. Only multi-word English no-match can use Cloud Translation; single-word misses, Medical, and provider errors do not. Raw dictionary responses are neither persisted nor forwarded to models, by KREN's conservative choice. |
| Korean Dictionary | One Korean headword to the Korean Basic Dictionary API; no English, surrounding context, or multimedia request. |
| Cloud Translation | Exact text, target code, and text-format setting to Google, omitting source code for detection. |
| Model Translation, Explain, Rewrite, Smart Grammar Check | Explicit text, fixed instruction, and visible settings to the selected provider. Harper and automatic paragraph checks stay local. Rewrite requests Minimal and Full variants. |
| User Dictionary | Expression and bounded instruction to the model; combined capture independently sends the expression to Merriam-Webster. Stored entries remain local without synchronization. |
| Tutor | Visible question/recipe, submitted exercises/answers, and requested lesson/conversation context to the chosen tutor provider, detailed below. |
| Reading | Cleaned speech copy to local System.Speech, or with Edge consent, cleaned text and voice/rate/volume to Microsoft's Edge speech service through unofficial edge-tts. Returned audio uses a temporary MP3 deleted after playback; no speech text file is written. |

When Smart Word Capture is on (the default), Add to User Dictionary also sends the single sentence that contains the selected word, if that sentence is 500 characters or shorter. The sentence is stored with the entry, exports with it, and the entry's Source line says a sentence was sent. Longer sentences are dropped rather than clipped. Turn Smart Word Capture off to send the selected expression alone. No neighboring sentence, paragraph, file name, or workspace path is added.

Cloudflare dictation uses the same in-memory recorder: only stopping sends one WAV clip to Cloudflare Workers AI Whisper, with no audio file. Auto chooses Handy, Cloudflare, Groq, then Gemini Free Tier. Cloudflare pictures and Whisper dictation share the account's free daily allowance of 10,000 neurons a day. A 1024 by 1024 FLUX.1 schnell picture used about 173 neurons in a test on 2026-10-10, roughly 57 pictures a day before dictation or other account use; Cloudflare does not report FLUX.2 klein 4B's usage. Continuation pictures from FLUX may not keep the same people.

Gemini dictation records pulse-code modulation (PCM) microphone samples in memory and assembles one Waveform Audio (WAV) clip in memory. Only stopping dictation sends that clip to Google for transcription; KREN writes no dictation audio file. Live uses its separate microphone streaming route. With KREN speech detection, Gemini's automatic activity detection is disabled; the local gate closes after its hangover, and the selected pause ends the turn. Suppressed sound and synthetic silence are not sent. Gemini + KREN streams real microphone audio while playback is unblocked, including sound below the gate. Speech returning before the pause ends stays in the same turn. Press to talk sends audio between its first and second presses only; transcription stays verbatim.

Microphone sensitivity sets the local gate. In Standard, Quiet room, Balanced, and Noisy room wait 500, 800, and 1000 milliseconds after your speech or its transcription before sending. Pause before reply controls the hands-free Live pause, from 1 to 5 seconds, default 2. These controls cannot make the provider answer faster. Microphone close wait gives Windows 2, 4, 6, or 8 seconds to release capture, default 4; the Windows microphone indicator can stay lit during that wait.

Tutor Ask sends its question and learning-map identifiers/labels. Empty Ask offers Weakness analysis or Text analysis; the modal shows the exact passage that would be sent with its instruction and map identifiers/labels. Dismissing it sends nothing. The passage is not retained separately in tutor state or the lesson recipe. Apply sends summary, observations, focus, target labels/roles, and learner level for prompt writing, withholding evidence fields; drafting sends that editable prompt. Find targets is local. Practice sends drafted examples and annotations; Hint includes its numbered example. Review sends the exercise, answer, and active targets or lesson question. Example Ask sends its sentence/question; reviewed-practice Ask sends its prompt/reviewed answer/question.

A lesson-source conversation snapshots subject, Primary/Support identifiers/roles/labels/descriptions, every example's sentence/target identifiers/annotation excerpts, and missed practice identifiers/prompts/target identifiers/saved reviewed answers. Opening, Standard turns, Live setup/accepted turn notes, Skip, Hint including prefetched Hint, deferred and retry coaching, and Demo casting and batches receive the same snapshot. This intentionally resubmits generated material and reviewed answers, possibly to a different provider. Later edits and Lesson Reset do not change it. Custom situation text goes only with opening or Demo casting. No document text, dictionary response, credential, path, workspace content, or unrelated history is added.

Diagnosis sends completed unskipped prompts, answers, corrections, and map identifiers/labels, excluding explanation prose. Naturalness suggestions are available at every learner level. With Take-home card on, stopping after at least one committed learner answer makes one TAKE-HOME request with the committed transcript KREN already sent and retained lesson context, excluding unsent drafts, skipped answers, and withheld turns. Edge card reading sends its text to Microsoft. With Chirp chosen, card reading sends text to Google Cloud Text-to-Speech; otherwise Live card reading uses a separate Gemini audio-generation session without a microphone. Cards, pictures, drafts, and transcripts remain in session memory. Chirp audio uses temporary MP3 files deleted after playback or Stop; other audio remains in session memory.

With Cloudflare chosen, pictures send the situation scene text and, for later pictures, the last six displayed dialogue turns to the Cloudflare Workers AI model selected in **Image Model**. No previous picture is sent. Continuation pictures may not keep the same people. The account ID and API token stay in SecretStorage and never enter panel HTML or logs.

With Gemini chosen, pictures send the situation intro to Gemini's Image Model. Intro Only requests one scene; Switching and Gradually Entering also send the last six dialogue turns from both sides, as shown in the conversation, and the most recent picture, up to ten pictures total. None sends nothing. No hidden corrections, deferred feedback, explanations, hints, panel settings, document text, or workspace content is included. Back to chat keeps pictures; Start new or panel closure discards them.

A completed Standard turn or the first Live reply fragment clears the current Hint before rendering the reply and cancels pending Hint work. Stop talking does not cancel Hint. Stop talking remains available while a Hint is pending; at an ordinary turn boundary, Stop conversation waits for that Hint to finish. Complete corrections appear under your turn in normal foreground text; correct sentences have no empty block. Standard names exact correction spans. Live correction starts when Gemini starts replying, without its reply transcript; teaching-mode highlights follow “Actually, you would say” through the sentence end.

KREN collects no telemetry or lookup/translation/explanation/grammar/rewrite history. It reads the clipboard once on the status click. API keys stay in VS Code Secret Storage, never settings, files, panel HTML, logs, or telemetry. Discovery and connection tests send no submitted text. Gemini/OpenAI/Anthropic authentication uses headers; Cloud Translation/Merriam-Webster/Korean use HTTPS query parameters which KREN never logs. Six native VS Code language-model tools confirm provider and exact text and add no workspace data; KREN bundles no MCP server or credential relay.

Open full details writes to VS Code Output, which may persist in session logs; clearing KREN does not delete those logs. Persistent local state includes settings, consent, usage, custom grammar words, ignored hashes, and saved User Dictionary entries. Provider billing and retention govern requests: OpenAI uses `store: false`, without guaranteeing zero retention; Anthropic retention depends on current terms and controls. See [Privacy](../PRIVACY.md).

### Limits and requirements

- No Node.js, npm, Python, GPU, or API key is required for ordinary installation or offline Grammar Check. Online actions need outbound HTTPS from the extension host.
- Merriam-Webster use is non-commercial: two reference works, 1000 queries per day per reference work, each lookup following explicit action.
- Cloud Translation's local ceiling is 500,000 submitted Unicode code points per Google billing month in Pacific Time. Failed/uncertain requests remain counted; unrelated clients are invisible. Use a dedicated project and provider-side quota.
- The default text limit is 5,000 characters, configurable from 1 to 20,000. The default request timeout is 30 seconds, configurable from 1 to 120. How long KREN waits for a provider. Cloudflare pictures wait at least 60 seconds; Google Cloud speech ignores this. Maximum entries per import defaults to 5,000.
- Tutor allows up to three Primary and three Support targets, 1 to 20 examples or practice items, and 20 Demo exchanges. Diagnosis requires five completed turns; TAKE-HOME requires at least one committed learner answer and is not generated for Demo.
- Local Windows reading needs PowerShell, System.Speech, and a voice. Edge also needs Python, edge-tts, network, and consent, and is disabled in Restricted Mode.
- KREN makes no service-tier claim. Gemini API users must be at least 18, use it for professional or business purposes, and meet project/regional eligibility; [available regions](https://ai.google.dev/gemini-api/docs/available-regions) and current terms govern access. Repeated requests can incur charges.

### Settings list

Run Preferences: Open Settings and filter for `kren` for all declared settings.

| Group | Controls |
| --- | --- |
| Startup and Panel | Reopen KREN at startup |
| Translation | Provider, Input/Output language, Maximum characters, Domain, LLM ROUTING |
| Grammar Check | Input language, Smart Grammar Check, automatic checking/delay, vocabulary/ignored findings, shared User Dictionary LLM ROUTING |
| Explain Meaning or Nuance | Explanation language, LLM ROUTING |
| Rewrite Text | CHANNEL/SUBJECT/REGISTER/SHAPE/INTENT/VARIANTS/OUTPUT; languages, Modality, Function, Domain, Formality, Voice, Stance, Length, Perspective, Rhetorical mode, Quick-menu rewrite, Protect formatting, Explain important edits, Show Read Aloud controls, Copy result to clipboard |
| Read Aloud (Windows) | Speech source, voice, language/region, speeds, Python command, Volume, preview |
| Dictionary | Translate unmatched phrases, Windows background pronunciation |
| User Dictionary | Enable User Dictionary, Smart Word Capture, Default capture mode, no-match fallback, route, Entry language, optional fields, Number of examples, Storage, Maximum entries per import, export/import, Purge |
| Display | Panel theme |
| Usage | Immediate result, Request timeout, Switch to the next provider, provider-order Move up and Move down, Requests today tally, Default Setting, Reset KREN |
| KREN menu, Credentials | Keys, Usage Check, Test, Delete all API keys |
| Tutor LESSON SETTING | Examples, sentence band/tolerance, learner level, mode/depth/annotations/common errors/practice count, CHANNEL/SUBJECT/REGISTER/SHAPE/INTENT |
| Tutor MODE/ADVANCED | Source, Situation, roles, Who starts, Register, Correction, transcription language, Replies, Reply length, pictures/transparencies, microphone sensitivity, pause, detection, close wait, Press to talk, Take-home card, Prepare hints in advance |
| Tutor VOICE & MODEL | Speech provider, TUTOR VOICE and LLM ROUTING; Thorough/Fast/Live/Image models, fallback, voices/previews |

Routing holds provider, Gemini profile, model, thinking/effort, and supported fallback. Gemini fallback is available on Free Tier and Paid for every feature. Gemini profiles store models independently; Refresh changes lists, not selection. When provider switching is on, a used-up daily or monthly free limit can send the same submitted text to the next provider with stored credentials, until local midnight. A Gemini overload after automatic retries can also switch providers for that request; it does not exhaust the Gemini pool until midnight. Live, pictures and dictation keep their selected provider. Settings are global to the VS Code profile; tutor content is session-only. Default Setting, Reset KREN, and Delete all API keys retain User Dictionary entries.

**Groq and Cloudflare language models.**

When Groq or Cloudflare Workers AI is the selected language-model provider, Translation, Explain Meaning or Nuance, Rewrite Text, and Smart Grammar Check send the explicitly submitted text and KREN's instruction for that feature. User Dictionary sends the selected expression and KREN's generation instruction, with the single bounded sentence when Smart Word Capture is on. Raw Merriam-Webster responses are never sent to either model. AI English Tutor sends the lesson targets and question for lessons; the relevant lesson and submitted answer for practice, hints, and diagnosis; displayed conversation turns and the submitted reply for Standard conversation, conversation hints, and take-home. These are the same explicit-action inputs used by the existing providers. No filenames, workspace paths, surrounding document paragraphs, other provider responses, or other provider credentials are added. Gemini remains the default. Live replies, Live voices, and Gemini speech detection use the stored Gemini profile key independently of the text provider. Groq, Cloudflare, OpenAI, and Anthropic still handle the routed text requests.

Limits checked on 2026-10-11: Groq's free plan permits 1,000 requests and 200,000 tokens per day per model, and 8,000 tokens per minute. Cloudflare text, pictures, and Whisper share the account's 10,000 daily neurons. Quotas and access can change. A limit or JSON-mode failure uses fixed KREN wording; no remote error text or credentials appear in a message. Responses pass local JSON parsing and each feature's validator. Groq uses strict schemas on openai/gpt-oss-120b, openai/gpt-oss-20b, and qwen/qwen3.8-27b; other Groq models use JSON object mode. Cloudflare JSON mode is best-effort and an invalid result is a KREN failure.

Create a key at [Groq Console](https://console.groq.com), **API Keys**. Use **KREN menu**, **Credentials**, the **Groq** row's **Set**, **Remove**, and **Test** actions, or **KREN: Set Groq API Key** and **KREN: Delete Groq API Key**. Choose **Groq** in the feature's **LLM ROUTING** provider list. The default is `openai/gpt-oss-120b`; `openai/gpt-oss-20b` and `qwen/qwen3.8-27b` are also offered. **Refresh** discovers models from Groq. Thinking levels map to low, medium, or high only on the two GPT-OSS models; Fast steps use low effort; Thorough steps use the configured level. Auto uses the lowest supported level. Cloudflare uses the existing account ID and API token in Credentials, with no new secret. Choose **Cloudflare Workers AI** in **LLM ROUTING**; the default is `@cf/meta/llama-3.3-70b-instruct-fp8-fast`. Its list also offers `@cf/meta/llama-3.1-8b-instruct`, `@cf/meta/llama-3-8b-instruct`, `@hf/nousresearch/hermes-2-pro-mistral-7b`, `@hf/thebloke/deepseek-coder-6.7b-instruct-awq`, and `@cf/deepseek-ai/deepseek-r1-distill-qwen-32b`, with no Refresh action.

Choose **Groq** in **Speech provider** in tutor **VOICE & MODEL** for Groq Whisper large v3 turbo dictation. Recording stays in memory; one WAV clip is sent to Groq at Stop, in one multipart request, and no audio file is written. Auto chooses Handy, Cloudflare, Groq, then Gemini Free Tier. The Groq API key is stored only in VS Code SecretStorage and used only with Groq; the Cloudflare token is used only with Cloudflare.
