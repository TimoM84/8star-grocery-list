/**
 * Prepares a product photo on the device before it is queued: applies the camera orientation,
 * scales it down and re-encodes it as JPEG. Re-encoding through a canvas also drops all
 * metadata (EXIF location, camera details). The server validates and strips again.
 */

export const PHOTO_MAX_EDGE = 1600;
export const PHOTO_QUALITY = 0.82;
/** Refuse absurd inputs before decoding them. */
export const PHOTO_MAX_INPUT_BYTES = 30 * 1024 * 1024;

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', ''];

export class PhotoError extends Error {}

export async function preparePhoto(file: Blob): Promise<Blob> {
	if (file.size > PHOTO_MAX_INPUT_BYTES) throw new PhotoError('Deze foto is te groot.');
	if (!ACCEPTED.includes(file.type) || file.type === 'image/svg+xml')
		throw new PhotoError('Kies een foto (JPEG, PNG of WebP).');
	let bitmap: ImageBitmap;
	try {
		bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
	} catch {
		throw new PhotoError('Deze foto kan niet worden gelezen.');
	}
	const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
	const width = Math.max(1, Math.round(bitmap.width * scale));
	const height = Math.max(1, Math.round(bitmap.height * scale));
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new PhotoError('Foto verwerken lukt niet op dit apparaat.');
	ctx.fillStyle = '#fff';
	ctx.fillRect(0, 0, width, height);
	ctx.drawImage(bitmap, 0, 0, width, height);
	bitmap.close();
	const blob = await new Promise<Blob | null>((resolve) =>
		canvas.toBlob(resolve, 'image/jpeg', PHOTO_QUALITY)
	);
	if (!blob) throw new PhotoError('Foto verwerken lukt niet op dit apparaat.');
	return blob;
}
