# uploadRegions

Starts in `showingUploadScreen`.

## States

### `showingUploadScreen` (start)

The upload screen is showing.

- `photoUploaded` → `showingUploadedPhoto`

Ignores `connectionLost`, `connectionRestored`, `photoPicked`, `uploadConfirmed`.

### `showingUploadedPhoto` (final)

The uploaded photo is showing.

Final: takes no events.

## Region `network`

### `network.online` (start)

The network region is online.

- `connectionLost` → `network.offline`

Ignores `connectionRestored`, `photoPicked`, `uploadConfirmed`.

### `network.offline`

The network region is offline.

- `connectionRestored` → `network.online`

Ignores `connectionLost`, `photoPicked`, `uploadConfirmed`.

## Region `upload`

### `upload.waitingForPhoto` (start)

The upload region waits for a photo.

- `photoPicked` → `upload.sendingPhoto`

Ignores `connectionLost`, `connectionRestored`, `uploadConfirmed`.

### `upload.photoSent` (final)

The photo was sent.

Final: takes no events.

### `upload.sendingPhoto`

The upload region is sending the photo.

- `uploadConfirmed` → `upload.photoSent`; sends out `photoUploaded`

Ignores `connectionLost`, `connectionRestored`, `photoPicked`.

## Events

- `connectionLost`: The connection was lost.
- `connectionRestored`: The connection came back.
- `photoPicked` with `fileName: string`: A photo was picked.
- `photoUploaded` (internal): The photo was uploaded (the upload region tells the screen).
- `uploadConfirmed`: The server confirmed the upload.
