import * as FileSystem from 'expo-file-system/legacy';

type MediaKind = 'avatar' | 'cover';

const MEDIA_DIR_NAME = 'profile-media';

function getFileExtension(uri: string): string {
  const cleanUri = uri.split('?')[0].split('#')[0];
  const lastDot = cleanUri.lastIndexOf('.');
  if (lastDot < 0) {
    return '.jpg';
  }

  const rawExtension = cleanUri.slice(lastDot);
  const extension = rawExtension.toLowerCase();
  if (!/^\.[a-z0-9]{1,8}$/.test(extension)) {
    return '.jpg';
  }

  return extension;
}

function isRemoteOrDataUri(uri: string): boolean {
  return /^(https?:|data:)/i.test(uri);
}

export async function persistProfileMediaUri(uri: string, kind: MediaKind): Promise<string> {
  const normalizedUri = uri.trim();
  if (!normalizedUri) {
    return uri;
  }

  if (isRemoteOrDataUri(normalizedUri)) {
    return normalizedUri;
  }

  const documentDirectory = FileSystem.documentDirectory;
  if (!documentDirectory) {
    return normalizedUri;
  }

  const mediaDirectory = `${documentDirectory}${MEDIA_DIR_NAME}`;
  if (normalizedUri.startsWith(`${mediaDirectory}/`)) {
    return normalizedUri;
  }

  try {
    const directoryInfo = await FileSystem.getInfoAsync(mediaDirectory);
    if (!directoryInfo.exists) {
      await FileSystem.makeDirectoryAsync(mediaDirectory, { intermediates: true });
    }

    const extension = getFileExtension(normalizedUri);
    const fileName = `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${extension}`;
    const destinationUri = `${mediaDirectory}/${fileName}`;

    await FileSystem.copyAsync({
      from: normalizedUri,
      to: destinationUri,
    });

    return destinationUri;
  } catch {
    if (!/^content:\/\//i.test(normalizedUri)) {
      return normalizedUri;
    }

    try {
      const extension = getFileExtension(normalizedUri);
      const fallbackFileName = `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${extension}`;
      const fallbackDestinationUri = `${mediaDirectory}/${fallbackFileName}`;
      const encoded = await FileSystem.readAsStringAsync(normalizedUri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      await FileSystem.writeAsStringAsync(fallbackDestinationUri, encoded, {
        encoding: FileSystem.EncodingType.Base64,
      });

      return fallbackDestinationUri;
    } catch {
      return normalizedUri;
    }
  }
}
