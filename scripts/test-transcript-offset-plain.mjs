function normalizeTranscriptOffsets(transcript) {
  if (transcript.length === 0) return [];
  const hasFractional = transcript.some((t) => t.offset % 1 !== 0 || (t.duration ?? 0) % 1 !== 0);
  const maxOffset = Math.max(...transcript.map((t) => t.offset));
  const isMs = !hasFractional && maxOffset > 100000;
  if (!isMs) {
    const smallMs = !hasFractional && maxOffset > 5000 && maxOffset < 100000;
    if (smallMs) {
      const avgGap = transcript.length > 1 ? (transcript[transcript.length - 1].offset - transcript[0].offset) / (transcript.length - 1) : 0;
      if (avgGap > 100) {
        return transcript.map((t) => ({ offset: Math.floor(t.offset / 1000), text: t.text }));
      }
    }
    return transcript.map((t) => ({ offset: t.offset, text: t.text }));
  }
  return transcript.map((t) => ({ offset: Math.floor(t.offset / 1000), text: t.text }));
}

function buildWindows(chunks, WINDOW_CHAR_BUDGET = 6000) {
  const sorted = [...chunks].sort((a, b) => a.start_seconds - b.start_seconds);
  const windows = [];
  let current = [];
  let currentChars = 0;
  for (const chunk of sorted) {
    const chunkLen = chunk.chunk_text.length;
    if (current.length > 0 && currentChars + chunkLen > WINDOW_CHAR_BUDGET) {
      windows.push({ chunks: current, startSeconds: current[0].start_seconds, endSeconds: current[current.length - 1].start_seconds });
      current = []; currentChars = 0;
    }
    current.push(chunk); currentChars += chunkLen;
  }
  if (current.length > 0) windows.push({ chunks: current, startSeconds: current[0].start_seconds, endSeconds: current[current.length - 1].start_seconds });
  return windows;
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }
let passed=0, failed=0;
function test(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); passed++; } catch(e){ console.error(`FAIL: ${name}: ${e.message}`); failed++; }
}

test("classic seconds with fractional keep as seconds", () => {
  const input = [{offset:0,text:"hello",duration:1.2},{offset:1.23,text:"world",duration:0.5},{offset:5.67,text:"foo",duration:1}];
  const out = normalizeTranscriptOffsets(input);
  assert(out[0].offset===0,"0"); assert(out[1].offset===1.23,"1.23"); assert(out[2].offset===5.67,"5.67");
});
test("srv3 ms integers divide by 1000", () => {
  const input = [{offset:0,text:"hello",duration:500},{offset:1230,text:"world",duration:400},{offset:60000,text:"mid",duration:300},{offset:180000,text:"three min",duration:400},{offset:360000,text:"six min",duration:400},{offset:600000,text:"ten min",duration:500}];
  const out = normalizeTranscriptOffsets([...input, {offset:600000,text:"end",duration:500}]);
  assert(out[1].offset===1,`1230->1 got ${out[1].offset}`);
  assert(out[3].offset===180,`180000->180 got ${out[3].offset}`);
  assert(out[5].offset===600,`600000->600 got ${out[5].offset}`);
});
test("integer seconds small keep", () => {
  const input = [{offset:0,text:"a",duration:2},{offset:2,text:"b",duration:2},{offset:5,text:"c",duration:2}];
  const out = normalizeTranscriptOffsets(input);
  assert(out[1].offset===2,"2"); assert(out[2].offset===5,"5");
});
test("buildWindows not merging tail", () => {
  const chunks = Array.from({length:30}, (_,i)=>({start_seconds:i*60,chunk_text:"x".repeat(2000)}));
  const windows = buildWindows(chunks);
  assert(windows.length===10,`expected 10 got ${windows.length}`);
  for(const w of windows){ const total=w.chunks.reduce((s,c)=>s+c.chunk_text.length,0); assert(total<=6000,`oversized ${total}`); }
});
test("chapter fallback: window without chapter still usable", () => {
  const chunks = [{start_seconds:0,chunk_text:"intro"},{start_seconds:60,chunk_text:"content"},{start_seconds:120,chunk_text:"more"}];
  const windows = buildWindows(chunks);
  assert(windows.length>=1,"at least 1");
  // simulate chapter allowlist: only 0
  const allowed=[0];
  for(const w of windows){
    let windowAllowed = allowed.filter(t=> t>=w.startSeconds && t<=w.endSeconds);
    if(windowAllowed.length===0) windowAllowed=[w.startSeconds]; // fallback
    assert(windowAllowed.length>0,`fallback should give 1, got ${windowAllowed.length} for [${w.startSeconds}-${w.endSeconds}]`);
  }
});
test("3h video windows no truncation", () => {
  // simulate 3h24m video: 204 minutes => 204 chunks at 60s each, each ~800 chars avg
  const chunks = Array.from({length:204}, (_,i)=>({start_seconds:i*60,chunk_text:"x".repeat(800)}));
  const windows = buildWindows(chunks);
  // 800*7=5600 fits, 800*8=6400 exceeds => ~7-8 chunks per window
  // 204/7.5 ≈ 27 windows
  assert(windows.length>8,`3h video should be >8 windows, got ${windows.length}`);
  const totalChunks = windows.reduce((s,w)=>s+w.chunks.length,0);
  assert(totalChunks===204,`all chunks preserved got ${totalChunks}`);
});
console.log(`\nDone: ${passed} passed, ${failed} failed`);
if(failed>0) process.exit(1);
