export const CLOUDFLARE_IMAGE_MODEL_DEFAULT = '@cf/black-forest-labs/flux-2-klein-4b';

/** Configuration inspection keeps manifest defaults separate from the reader's choices. */
export interface PictureSettingInspection<T> {
  globalValue?: T;
  workspaceValue?: T;
  workspaceFolderValue?: T;
  globalLanguageValue?: T;
  workspaceLanguageValue?: T;
  workspaceFolderLanguageValue?: T;
  defaultValue?: T;
}

function explicitValue<T>(inspection: PictureSettingInspection<T> | undefined): T | undefined {
  return inspection?.workspaceFolderLanguageValue ?? inspection?.workspaceLanguageValue ??
    inspection?.globalLanguageValue ?? inspection?.workspaceFolderValue ??
    inspection?.workspaceValue ?? inspection?.globalValue;
}

/** Pure effective settings shared by the panel and its picture execution action. */
export function effectivePictureSettings(
  provider: PictureSettingInspection<'gemini' | 'cloudflare'> | undefined,
  imageModel: PictureSettingInspection<string> | undefined,
  credentials: { cloudflareAccountId?: boolean; cloudflareApiToken?: boolean }
) {
  const explicit = explicitValue(provider);
  const tutorPictureProvider = explicit ??
    (credentials.cloudflareAccountId && credentials.cloudflareApiToken ? 'cloudflare' : 'gemini');
  return {
    tutorPictureProvider,
    tutorCloudflareImageModel: explicitValue(imageModel) ?? CLOUDFLARE_IMAGE_MODEL_DEFAULT,
    tutorPictureProviderAutomatic: explicit === undefined
  };
}
