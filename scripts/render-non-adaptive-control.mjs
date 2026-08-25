import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const trajectoryPath = resolve(
  root,
  'study-control/non-adaptive-trajectory.approved.jsonl',
);
const records = readFileSync(trajectoryPath, 'utf8')
  .trim()
  .split(/\r?\n/)
  .map(JSON.parse);
if (
  records.length !== 2 ||
  records[0].timestampMs !== 0 ||
  records[1].timestampMs !== 270_000
)
  throw new Error(
    'Approved control trajectory no longer matches the reviewed two-plan schedule.',
  );

const audio = (...parts) => resolve(root, 'frontend/public/audio', ...parts);
const output = resolve(
  root,
  'frontend/public/audio/control/non-adaptive-10min.mp3',
);
mkdirSync(dirname(output), { recursive: true });
const ffmpeg =
  process.env.FFMPEG_PATH ||
  resolve(root, 'node_modules/ffmpeg-static/ffmpeg.exe');
if (!existsSync(ffmpeg))
  throw new Error(
    'FFmpeg is unavailable. Set FFMPEG_PATH or temporarily install ffmpeg-static.',
  );

const inputs = [
  audio('forest/ambient/forest_ambient_bed_01.mp3'),
  audio('forest/ambient/forest_wind_leaves_01.mp3'),
  audio('forest/ambient/forest_stream_ambient_bed_01.mp3'),
  audio('forest/event/forest_water_drop_far_01.wav'),
];
const filter = [
  '[0:a]atrim=0:600,asetpts=PTS-STARTPTS,volume=0.076,afade=t=in:st=0:d=4,afade=t=out:st=596:d=4[bed]',
  '[1:a]atrim=0:600,asetpts=PTS-STARTPTS,volume=0.036,afade=t=in:st=0:d=4,afade=t=out:st=596:d=4[wind]',
  '[2:a]atrim=0:330,asetpts=PTS-STARTPTS,volume=0.116,afade=t=in:st=0:d=4,afade=t=out:st=326:d=4,adelay=270000|270000[stream]',
  '[3:a]atrim=0:6,asetpts=PTS-STARTPTS,volume=0.2,afade=t=in:st=0:d=0.3,afade=t=out:st=4.8:d=1.2,adelay=274000|274000[drop]',
  '[bed][wind][stream][drop]amix=inputs=4:duration=longest:normalize=0,alimiter=limit=0.95,atrim=0:600[out]',
].join(';');
const args = [
  '-y',
  ...inputs.flatMap((input, index) =>
    index < 3 ? ['-stream_loop', '-1', '-i', input] : ['-i', input],
  ),
  '-filter_complex',
  filter,
  '-map',
  '[out]',
  '-ar',
  '48000',
  '-ac',
  '2',
  '-c:a',
  'libmp3lame',
  '-b:a',
  '192k',
  output,
];
const result = spawnSync(ffmpeg, args, { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`Rendered approved shared control audio: ${output}`);
