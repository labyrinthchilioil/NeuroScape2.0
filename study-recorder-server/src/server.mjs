import { createStudyServer } from './server-lib.mjs';
import { loadEnvFile } from 'node:process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(
  fileURLToPath(new URL('../..', import.meta.url)),
);
try {
  loadEnvFile(resolve(repositoryRoot, '.env'));
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

const port = Number(process.env.NEUROSCAPE_STUDY_PORT ?? 8787);
const server = createStudyServer();
server.listen(port, '127.0.0.1', () => {
  console.log(`NeuroScape study recorder: http://127.0.0.1:${port}`);
  console.log(
    `Results directory: ${process.env.NEUROSCAPE_RESULTS_DIR ?? 'study-results'}`,
  );
  console.log(
    `OpenAI planner: ${process.env.OPENAI_API_KEY ? 'enabled' : 'disabled (OPENAI_API_KEY missing)'}`,
  );
});
