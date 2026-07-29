# Provider Setup

KREN is bring-your-own-key. A ChatGPT, Claude, Gemini app, or Google One subscription does not automatically include API access or API credits.

## Dictionary providers

Each user must register for and enter their own provider keys. KREN includes no shared credentials.

For Merriam-Webster, obtain the Collegiate Dictionary and Collegiate Thesaurus keys from your own [Merriam-Webster developer account](https://dictionaryapi.com/register/index). Store them with the matching KREN commands. Merriam-Webster's standard free terms limit use to noncommercial applications, no more than two reference works, and 1,000 queries per day per reference. Review the current [Merriam-Webster API terms](https://dictionaryapi.com/info/terms-of-service).

Korean Dictionary Search requires a separate Korean Basic Dictionary Open API key. All dictionary keys are stored locally in VS Code Secret Storage and are not bundled, published, logged, or shared by KREN.

## Google Cloud Translation

Enable Cloud Translation Basic v2 for a Google Cloud project, create a restricted API key, then run **KREN: Set Google Cloud Translation API Key**. KREN enforces a local shared monthly guard below 500,000 characters, but Google billing remains authoritative. Configure a billing budget and alert in Google Cloud.

## Gemini

Run **KREN: Set Default Gemini API Key** for the Default profile. Explain Meaning or Nuance and Rewrite / Polish Text can optionally use a separately supplied key through **KREN: Set Alternate Gemini API Key**. Choose the profile independently for Explain and Rewrite. KREN does not classify either key by service tier. Gemini is available only in [regions listed by Google](https://ai.google.dev/gemini-api/docs/available-regions). Availability, access, quotas, pricing, data use, and permitted use depend on the user's Google project and region; review the current [Gemini API terms](https://ai.google.dev/gemini-api/terms) and [documentation](https://ai.google.dev/gemini-api/docs).

## OpenAI API

Create an API key in the OpenAI platform, configure project billing/limits there, and run **KREN: Set OpenAI API Key**. Choose OpenAI independently for explanation and rewriting. KREN uses the Responses API with structured output and `store: false`. See the [OpenAI API documentation](https://platform.openai.com/docs/api-reference/responses).

## Anthropic Claude API

Create an Anthropic Console API key and configure billing/limits there, then run **KREN: Set Anthropic API Key**. Choose Anthropic independently for explanation and rewriting. See the [Anthropic Messages API documentation](https://docs.anthropic.com/en/api/messages).

## Models and connection tests

Model fields are editable so future IDs can be entered. The Refresh buttons query only the selected provider's model-list endpoint. Run **KREN: Test OpenAI Connection** or **KREN: Test Anthropic Connection** to validate the stored key without sending selected text.

## Remove stored keys

Open KREN Settings and use **Remove key** beside an individual provider, or choose **Delete all stored API keys** and confirm. The same provider-specific delete commands are available from the Command Palette. Remove keys explicitly before uninstalling or deleting a test profile; uninstalling alone is not KREN's credential-removal workflow.
