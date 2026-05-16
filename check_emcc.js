import { execSync } from 'child_process';
try {
  const out = execSync('emcc --version', { stdio: 'pipe' });
  console.log(out.toString());
} catch(e) {
  console.log(e.toString());
}
