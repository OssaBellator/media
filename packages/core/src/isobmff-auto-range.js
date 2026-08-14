import { demuxIsoBmffSource, scanIsoTopLevelSource } from './isobmff-range.js';
import { demuxFragmentedIsoBmffSource } from './isobmff-fragment-range.js';

export async function demuxIsoBmffAutoSource(source, options = {}) {
  const scan = await scanIsoTopLevelSource(source, { signal: options.signal });
  const fragmented = scan.boxes.some((box) => box.type === 'moof');
  if (!fragmented) return demuxIsoBmffSource(source, options);
  try {
    return await demuxFragmentedIsoBmffSource(source, options);
  } catch (error) {
    const fallbackLimit = Number(options.fragmentedFallbackMaxBytes ?? 256 * 1024 * 1024);
    if (Number(source.size) > fallbackLimit) {
      error.message = `Sparse fragmented-MP4 indexing failed and source exceeds fallback limit: ${error.message}`;
      throw error;
    }
    const result = await demuxIsoBmffSource(source, options);
    return {
      ...result,
      metadata: {
        ...(result.metadata ?? {}),
        sparseFragmentAttempted: true,
        sparseFragmentReason: error.message,
      },
    };
  }
}
