const HLS_PREFIX = '#EXTM3U';

function resolveUrl(value, baseUrl) {
  if (!value) return null;
  try { return baseUrl ? new URL(value, baseUrl).href : String(value); }
  catch { return String(value); }
}
function parseNumber(value, fallback = null) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function parseYesNo(value) { return String(value ?? '').toUpperCase() === 'YES'; }
function stripQuotes(value) { const s = String(value ?? '').trim(); return s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s; }
export function parseAttributeList(text = '') {
  const out = {}; let token = '', quoted = false;
  const flush = () => { if (!token.trim()) return; const i = token.indexOf('='); if (i > 0) out[token.slice(0, i).trim()] = stripQuotes(token.slice(i + 1)); token = ''; };
  for (const ch of String(text)) { if (ch === '"') quoted = !quoted; if (ch === ',' && !quoted) { flush(); continue; } token += ch; }
  flush(); return out;
}
function byteRange(value, previousEnd = 0) {
  if (!value) return null;
  const [lengthText, offsetText] = String(value).split('@'); const length = parseNumber(lengthText, 0); const offset = offsetText == null ? previousEnd : parseNumber(offsetText, previousEnd);
  return { offset, length, end: offset + length };
}
function hlsKey(attrs, baseUrl) { return attrs ? { method: attrs.METHOD ?? 'NONE', uri: resolveUrl(attrs.URI, baseUrl), iv: attrs.IV ?? null, keyFormat: attrs.KEYFORMAT ?? 'identity', keyFormatVersions: attrs.KEYFORMATVERSIONS ?? null } : null; }
function hlsMap(attrs, baseUrl) { return attrs?.URI ? { url: resolveUrl(attrs.URI, baseUrl), byteRange: byteRange(attrs.BYTERANGE, 0) } : null; }
function parseResolution(value) { const m = /^(\d+)x(\d+)$/i.exec(String(value ?? '')); return m ? { width: Number(m[1]), height: Number(m[2]) } : {}; }
function variantFromStream(attrs, url) {
  return { id: `hls:${attrs['STABLE-VARIANT-ID'] ?? attrs.BANDWIDTH ?? url}`, url, bandwidth: parseNumber(attrs.BANDWIDTH), averageBandwidth: parseNumber(attrs['AVERAGE-BANDWIDTH']), codecs: attrs.CODECS ?? null, frameRate: parseNumber(attrs['FRAME-RATE']), audioGroup: attrs.AUDIO ?? null, subtitleGroup: attrs.SUBTITLES ?? null, closedCaptions: attrs['CLOSED-CAPTIONS'] ?? null, videoRange: attrs['VIDEO-RANGE'] ?? null, ...parseResolution(attrs.RESOLUTION) };
}
export function parseHlsManifest(text, { baseUrl = null } = {}) {
  const raw = String(text ?? '').replace(/^\uFEFF/, '').trim(); if (!raw.startsWith(HLS_PREFIX)) throw new Error('HLS manifest must begin with #EXTM3U');
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean), variants = [], renditions = [], segments = [], parts = [];
  let pendingStream = null, pendingDuration = null, pendingTitle = '', pendingByteRange = null, pendingProgramDateTime = null, pendingDiscontinuity = false, pendingGap = false;
  let currentMap = null, currentKey = null, previousRangeEnd = 0, mediaSequence = 0, sequence = 0, targetDuration = null, partTarget = null, endList = false, playlistType = null, discontinuitySequence = 0, serverControl = {}, preloadHint = null, version = null, skippedSegments = 0, renditionReports = [], startOffset = null;
  for (const line of lines.slice(1)) {
    if (pendingStream && !line.startsWith('#')) { variants.push(variantFromStream(pendingStream, resolveUrl(line, baseUrl))); pendingStream = null; continue; }
    if (!line.startsWith('#')) {
      const range = byteRange(pendingByteRange, previousRangeEnd); if (range) previousRangeEnd = range.end;
      const duration = Math.max(0, parseNumber(pendingDuration, 0)), start = segments.length ? segments.at(-1).start + segments.at(-1).duration : 0;
      segments.push({ id: `hls-segment:${sequence}`, sequence, url: resolveUrl(line, baseUrl), start, duration, title: pendingTitle, byteRange: range, map: currentMap, key: currentKey, programDateTime: pendingProgramDateTime, discontinuity: pendingDiscontinuity, gap: pendingGap, partial: false });
      sequence++; pendingDuration = null; pendingTitle = ''; pendingByteRange = null; pendingProgramDateTime = null; pendingDiscontinuity = false; pendingGap = false; continue;
    }
    const match = /^([^:]+)(?::(.*))?$/.exec(line), tag = match?.[1] ?? line, value = match?.[2] ?? '';
    switch (tag) {
      case '#EXT-X-VERSION': version = parseNumber(value); break;
      case '#EXT-X-STREAM-INF': pendingStream = parseAttributeList(value); break;
      case '#EXT-X-I-FRAME-STREAM-INF': { const attrs = parseAttributeList(value); variants.push({ ...variantFromStream(attrs, resolveUrl(attrs.URI, baseUrl)), iframeOnly: true }); break; }
      case '#EXT-X-MEDIA': { const a = parseAttributeList(value); renditions.push({ type: a.TYPE ?? null, groupId: a['GROUP-ID'] ?? null, name: a.NAME ?? null, language: a.LANGUAGE ?? null, default: parseYesNo(a.DEFAULT), autoselect: parseYesNo(a.AUTOSELECT), forced: parseYesNo(a.FORCED), channels: a.CHANNELS ?? null, uri: resolveUrl(a.URI, baseUrl) }); break; }
      case '#EXTINF': { const comma = value.indexOf(','); pendingDuration = parseNumber(comma < 0 ? value : value.slice(0, comma), 0); pendingTitle = comma < 0 ? '' : value.slice(comma + 1); break; }
      case '#EXT-X-MEDIA-SEQUENCE': mediaSequence = parseNumber(value, 0); sequence = mediaSequence; break;
      case '#EXT-X-TARGETDURATION': targetDuration = parseNumber(value); break;
      case '#EXT-X-PLAYLIST-TYPE': playlistType = value || null; break;
      case '#EXT-X-ENDLIST': endList = true; break;
      case '#EXT-X-DISCONTINUITY': pendingDiscontinuity = true; break;
      case '#EXT-X-DISCONTINUITY-SEQUENCE': discontinuitySequence = parseNumber(value, 0); break;
      case '#EXT-X-BYTERANGE': pendingByteRange = value; break;
      case '#EXT-X-MAP': currentMap = hlsMap(parseAttributeList(value), baseUrl); break;
      case '#EXT-X-KEY': currentKey = hlsKey(parseAttributeList(value), baseUrl); break;
      case '#EXT-X-PROGRAM-DATE-TIME': pendingProgramDateTime = value; break;
      case '#EXT-X-GAP': pendingGap = true; break;
      case '#EXT-X-PART-INF': partTarget = parseNumber(parseAttributeList(value)['PART-TARGET']); break;
      case '#EXT-X-SERVER-CONTROL': { const a = parseAttributeList(value); serverControl = { canBlockReload: parseYesNo(a['CAN-BLOCK-RELOAD']), canSkipUntil: parseNumber(a['CAN-SKIP-UNTIL']), holdBack: parseNumber(a['HOLD-BACK']), partHoldBack: parseNumber(a['PART-HOLD-BACK']) }; break; }
      case '#EXT-X-PART': { const a = parseAttributeList(value), duration = parseNumber(a.DURATION, 0), start = parts.length ? parts.at(-1).start + parts.at(-1).duration : (segments.length ? segments.at(-1).start + segments.at(-1).duration : 0); parts.push({ id: `hls-part:${sequence}:${parts.length}`, sequence, url: resolveUrl(a.URI, baseUrl), start, duration, independent: parseYesNo(a.INDEPENDENT), gap: parseYesNo(a.GAP), byteRange: byteRange(a.BYTERANGE, previousRangeEnd), partial: true, key: currentKey, map: currentMap }); break; }
      case '#EXT-X-PRELOAD-HINT': { const a = parseAttributeList(value); preloadHint = { type: a.TYPE ?? null, url: resolveUrl(a.URI, baseUrl), byteRangeStart: parseNumber(a['BYTERANGE-START']), byteRangeLength: parseNumber(a['BYTERANGE-LENGTH']) }; break; }
      case '#EXT-X-SKIP': { const a = parseAttributeList(value); skippedSegments = Math.max(0, Math.trunc(parseNumber(a['SKIPPED-SEGMENTS'], 0))); sequence = Math.max(sequence, mediaSequence + skippedSegments); break; }
      case '#EXT-X-RENDITION-REPORT': { const a = parseAttributeList(value); renditionReports.push({ url: resolveUrl(a.URI, baseUrl), lastMsn: parseNumber(a['LAST-MSN']), lastPart: parseNumber(a['LAST-PART']) }); break; }
      case '#EXT-X-START': { const a = parseAttributeList(value); startOffset = parseNumber(a['TIME-OFFSET']); break; }
      default: break;
    }
  }
  const kind = variants.length ? 'master' : 'media';
  return { schema: 'media.adaptive.v1', protocol: 'hls', kind, baseUrl, version, isLive: kind === 'media' && !endList, playlistType, targetDuration, partTarget, mediaSequence, discontinuitySequence, serverControl, preloadHint, skippedSegments, renditionReports, startOffset, variants, renditions, segments, parts, duration: segments.reduce((n, s) => n + s.duration, 0) };
}

function parseXmlAttributes(source = '') { const attrs = {}; for (const m of source.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[m[1]] = m[2] ?? m[3] ?? ''; return attrs; }
function xmlName(name) { return String(name).split(':').at(-1); }
export function parseXmlLite(xml) {
  const root = { name: '#document', attrs: {}, children: [], text: '' }, stack = [root];
  for (const token of String(xml ?? '').replace(/<!--[\s\S]*?-->/g, '').match(/<[^>]+>|[^<]+/g) ?? []) {
    if (token.startsWith('<?') || token.startsWith('<!')) continue;
    if (token.startsWith('</')) { if (stack.length > 1) stack.pop(); continue; }
    if (token.startsWith('<')) { const selfClosing = /\/\s*>$/.test(token), m = /^<\s*([^\s/>]+)([\s\S]*?)\/?\s*>$/.exec(token); if (!m) continue; const node = { name: xmlName(m[1]), qualifiedName: m[1], attrs: parseXmlAttributes(m[2]), children: [], text: '' }; stack.at(-1).children.push(node); if (!selfClosing) stack.push(node); continue; }
    stack.at(-1).text += token;
  }
  return root.children[0] ?? root;
}
function child(node, name) { return node?.children?.find((item) => item.name === name) ?? null; }
function children(node, name) { return node?.children?.filter((item) => item.name === name) ?? []; }
function inheritedBase(node, parentBase) { const base = child(node, 'BaseURL')?.text?.trim(); return resolveUrl(base, parentBase) ?? parentBase; }
export function parseIsoDuration(value) { if (value == null) return null; const m = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(String(value)); if (!m) return null; return Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0); }
function replaceTemplate(template, vars) { return String(template ?? '').replace(/\$\$/g, '\0').replace(/\$(RepresentationID|Bandwidth|Number|Time)(?:%0(\d+)d)?\$/g, (_, key, width) => { const value = vars[key] ?? ''; return width ? String(value).padStart(Number(width), '0') : String(value); }).replace(/\0/g, '$'); }
function segmentTemplate(node) { const template = child(node, 'SegmentTemplate'); return template ? { ...template.attrs, timeline: child(template, 'SegmentTimeline') } : null; }
function mergeTemplate(parent, own) { return (!parent && !own) ? null : { ...(parent ?? {}), ...(own ?? {}), timeline: own?.timeline ?? parent?.timeline ?? null }; }
function expandTimeline(timeline, { timescale = 1, periodDuration = null, maxSegments = 10000 } = {}) {
  if (!timeline) return []; const result = []; let current = 0, index = 0;
  for (const s of children(timeline, 'S')) { const d = parseNumber(s.attrs.d, 0); if (!(d > 0)) continue; if (s.attrs.t != null) current = parseNumber(s.attrs.t, current); let repeat = Math.trunc(parseNumber(s.attrs.r, 0)); if (repeat < 0) repeat = periodDuration == null ? 0 : Math.max(0, Math.ceil(periodDuration * timescale / d) - 1); repeat = Math.min(repeat, maxSegments - result.length - 1); for (let i = 0; i <= repeat && result.length < maxSegments; i++) { result.push({ time: current, duration: d, index: index++ }); current += d; } }
  return result;
}
function dashProtection(nodes) { return nodes.flatMap((node) => children(node, 'ContentProtection')).map((item) => ({ schemeIdUri: item.attrs.schemeIdUri ?? null, value: item.attrs.value ?? null, defaultKID: item.attrs['cenc:default_KID'] ?? item.attrs.default_KID ?? null, pssh: child(item, 'pssh')?.text?.trim() ?? null })); }
function dashSegments(template, { representationId, bandwidth, baseUrl, periodDuration, isDynamic, dynamicWindow = null, maxSegments = 10000 } = {}) {
  if (!template) return { initialization: null, segments: [] };
  const timescale = Math.max(1, parseNumber(template.timescale, 1)), startNumber = Math.max(0, Math.trunc(parseNumber(template.startNumber, 1))), init = template.initialization ? resolveUrl(replaceTemplate(template.initialization, { RepresentationID: representationId, Bandwidth: bandwidth }), baseUrl) : null, segments = [];
  const timeline = expandTimeline(template.timeline, { timescale, periodDuration: periodDuration ?? dynamicWindow?.end ?? null, maxSegments });
  if (timeline.length) {
    for (let i = 0; i < timeline.length; i++) { const e = timeline[i], number = startNumber + i, url = resolveUrl(replaceTemplate(template.media, { RepresentationID: representationId, Bandwidth: bandwidth, Number: number, Time: e.time }), baseUrl); segments.push({ id: `dash:${representationId}:${number}`, sequence: number, url, start: e.time / timescale, duration: e.duration / timescale, time: e.time, partial: false }); }
  } else {
    const duration = parseNumber(template.duration);
    if (duration > 0 && template.media) { const segmentDuration = duration / timescale; let firstIndex = 0, total = 0; if (periodDuration != null) total = Math.ceil(periodDuration / segmentDuration); else if (isDynamic && dynamicWindow) { firstIndex = Math.max(0, Math.floor(dynamicWindow.start / segmentDuration)); const lastIndex = Math.max(firstIndex, Math.floor(dynamicWindow.end / segmentDuration)); total = Math.min(maxSegments, lastIndex - firstIndex + 1); } else if (isDynamic) total = Math.min(12, maxSegments); for (let local = 0; local < total; local++) { const i = firstIndex + local, number = startNumber + i, time = i * duration, url = resolveUrl(replaceTemplate(template.media, { RepresentationID: representationId, Bandwidth: bandwidth, Number: number, Time: time }), baseUrl); segments.push({ id: `dash:${representationId}:${number}`, sequence: number, url, start: i * segmentDuration, duration: segmentDuration, time, partial: false }); } }
  }
  return { initialization: init, segments };
}

function parseDashRange(value){if(!value)return null;const m=/^(\d+)-(\d+)$/.exec(String(value));if(!m)return null;const offset=Number(m[1]),endInclusive=Number(m[2]);return{offset,length:Math.max(0,endInclusive-offset+1),end:endInclusive+1};}
function findSegmentList(...nodes){for(const node of nodes){const list=child(node,'SegmentList');if(list)return list;}return null;}

function findSegmentBase(...nodes){for(const node of nodes){const base=child(node,'SegmentBase');if(base)return base;}return null;}
function dashSegmentBase(base,{baseUrl}={}){if(!base)return null;const init=child(base,'Initialization');return{url:baseUrl,indexRange:parseDashRange(base.attrs.indexRange),initialization:init?resolveUrl(init.attrs.sourceURL??baseUrl,baseUrl):null,initializationRange:parseDashRange(init?.attrs?.range),timescale:parseNumber(base.attrs.timescale,1),presentationTimeOffset:parseNumber(base.attrs.presentationTimeOffset,0)};}
function dashListSegments(list,{baseUrl,periodDuration=null,periodStart=0}={}){if(!list)return null;const timescale=Math.max(1,parseNumber(list.attrs.timescale,1)),durationUnits=parseNumber(list.attrs.duration),startNumber=Math.max(0,Math.trunc(parseNumber(list.attrs.startNumber,1))),timeline=child(list,'SegmentTimeline'),timelineEntries=expandTimeline(timeline,{timescale,periodDuration}),urls=children(list,'SegmentURL'),initNode=child(list,'Initialization'),initialization=initNode?resolveUrl(initNode.attrs.sourceURL??baseUrl,baseUrl):null,initializationRange=parseDashRange(initNode?.attrs?.range),segments=[];let cursor=0;for(let i=0;i<urls.length;i++){const item=urls[i],entry=timelineEntries[i],duration=entry?entry.duration/timescale:(durationUnits?durationUnits/timescale:0),start=entry?entry.time/timescale:cursor;segments.push({id:`dash-list:${startNumber+i}`,sequence:startNumber+i,url:resolveUrl(item.attrs.media??baseUrl,baseUrl),start:start+periodStart,duration,byteRange:parseDashRange(item.attrs.mediaRange),indexRange:parseDashRange(item.attrs.indexRange),partial:false});cursor=start+duration;}return{initialization,initializationRange,segments};}
export function parseDashManifest(xml, { baseUrl = null, maxSegments = 10000, now = Date.now() } = {}) {
  const root = parseXmlLite(xml); if (root.name !== 'MPD') throw new Error('DASH manifest root must be MPD');
  const isDynamic = String(root.attrs.type ?? 'static').toLowerCase() === 'dynamic', mpdDuration = parseIsoDuration(root.attrs.mediaPresentationDuration), mpdBase = inheritedBase(root, baseUrl), variants = [], timeShiftBufferDepth = parseIsoDuration(root.attrs.timeShiftBufferDepth), availabilityStartMs = Date.parse(root.attrs.availabilityStartTime ?? ''), presentationNow = isDynamic && Number.isFinite(availabilityStartMs) ? Math.max(0, (Number(now) - availabilityStartMs) / 1000) : null;
  let periodStart = 0; const periods = children(root, 'Period');
  for (let p = 0; p < periods.length; p++) {
    const period = periods[p], explicitStart = parseIsoDuration(period.attrs.start); if (explicitStart != null) periodStart = explicitStart;
    const periodDuration = parseIsoDuration(period.attrs.duration) ?? (mpdDuration != null ? Math.max(0, mpdDuration - periodStart) : null), periodBase = inheritedBase(period, mpdBase), periodTemplate = segmentTemplate(period), periodProtection = dashProtection([period]);
    for (const adaptation of children(period, 'AdaptationSet')) {
      const adaptationBase = inheritedBase(adaptation, periodBase), adaptationTemplate = mergeTemplate(periodTemplate, segmentTemplate(adaptation)), adaptationProtection = [...periodProtection, ...dashProtection([adaptation])], contentType = adaptation.attrs.contentType ?? (String(adaptation.attrs.mimeType ?? '').split('/')[0] || null);
      for (const representation of children(adaptation, 'Representation')) {
        const id = representation.attrs.id ?? `${p}:${variants.length}`, representationBase = inheritedBase(representation, adaptationBase), template = mergeTemplate(adaptationTemplate, segmentTemplate(representation)), bandwidth = parseNumber(representation.attrs.bandwidth), dynamicEnd = presentationNow == null ? null : Math.max(0, presentationNow - periodStart), dynamicWindow = dynamicEnd == null ? null : { start: Math.max(0, dynamicEnd - (timeShiftBufferDepth ?? 30)), end: dynamicEnd }, listInfo = dashListSegments(findSegmentList(representation, adaptation, period), { baseUrl: representationBase, periodDuration, periodStart }), baseInfo = dashSegmentBase(findSegmentBase(representation, adaptation, period), { baseUrl: representationBase }), segmentInfo = listInfo ?? dashSegments(template, { representationId: id, bandwidth, baseUrl: representationBase, periodDuration, isDynamic, dynamicWindow, maxSegments }), protection = [...adaptationProtection, ...dashProtection([representation])];
        variants.push({ id: `dash:${id}`, representationId: id, periodIndex: p, type: representation.attrs.contentType ?? contentType, mimeType: representation.attrs.mimeType ?? adaptation.attrs.mimeType ?? null, codecs: representation.attrs.codecs ?? adaptation.attrs.codecs ?? null, bandwidth, width: parseNumber(representation.attrs.width ?? adaptation.attrs.width), height: parseNumber(representation.attrs.height ?? adaptation.attrs.height), frameRate: representation.attrs.frameRate ?? adaptation.attrs.frameRate ?? null, audioSamplingRate: parseNumber(representation.attrs.audioSamplingRate ?? adaptation.attrs.audioSamplingRate), baseUrl: representationBase, initialization: baseInfo?.initialization ?? segmentInfo.initialization, initializationRange: baseInfo?.initializationRange ?? segmentInfo.initializationRange ?? null, segmentBase: baseInfo, segments: listInfo ? segmentInfo.segments : segmentInfo.segments.map((segment) => ({ ...segment, start: segment.start + periodStart })), protection });
      }
    }
    periodStart += periodDuration ?? 0;
  }
  return { schema: 'media.adaptive.v1', protocol: 'dash', kind: 'mpd', baseUrl: mpdBase, isLive: isDynamic, type: root.attrs.type ?? 'static', minimumUpdatePeriod: parseIsoDuration(root.attrs.minimumUpdatePeriod), timeShiftBufferDepth, suggestedPresentationDelay: parseIsoDuration(root.attrs.suggestedPresentationDelay), minBufferTime: parseIsoDuration(root.attrs.minBufferTime), availabilityStartTime: root.attrs.availabilityStartTime ?? null, duration: mpdDuration, variants };
}
export function parseAdaptiveManifest(text, { baseUrl = null, contentType = null } = {}) { const source = String(text ?? '').trim(), type = String(contentType ?? '').toLowerCase(); if (type.includes('mpegurl') || source.startsWith(HLS_PREFIX)) return parseHlsManifest(source, { baseUrl }); if (type.includes('dash+xml') || /^<\?xml|^<MPD\b/i.test(source)) return parseDashManifest(source, { baseUrl }); throw new Error('Unsupported adaptive manifest format'); }
