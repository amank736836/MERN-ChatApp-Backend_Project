import axios from 'axios';
import fs from 'fs';
import path from 'path';

const BACKEND_URL = 'https://mern-chatapp-backend-oyek.onrender.com/api/v1';

async function checkEndpoint(name, endpoint) {
  console.log(`Testing ${name}: ${endpoint}...`);
  try {
    const response = await axios.get(`${BACKEND_URL}${endpoint}`);
    console.log(`✅ ${name} responded with status ${response.status}`);
    return true;
  } catch (error) {
    console.error(`❌ ${name} failed: ${error.response?.status || error.message}`);
    return false;
  }
}

async function scanForJSXErrors() {
  console.log('Scanning frontend for JSX syntax errors (<<)...');
  const frontendPath = path.join(process.cwd(), '..', 'chat-next-frontend');
  let errorsFound = 0;

  const walk = (dir) => {
    fs.readdirSync(dir).forEach(file => {
      const fullPath = path.join(dir, file);
      if (fs.statSync(fullPath).isDirectory()) {
        walk(fullPath);
      } else if (fullPath.endsWith('.jsx') || fullPath.endsWith('.tsx')) {
        const content = fs.readFileSync(fullPath, 'utf8');
        if (content.includes('<<')) {
          console.log(`🚨 Syntax error found in ${fullPath}`);
          errorsFound++;
        }
      }
    });
  };

  walk(frontendPath);
  console.log(`Scan complete. Found ${errorsFound} files with potential JSX errors.`);
  return errorsFound === 0;
}

async function run() {
  console.log('🚀 Starting Rigorous Smoke Test Cycle\n');

  const results = [];
  results.push(await checkEndpoint('Home Page', '/'));
  results.push(await checkEndpoint('User API', '/user/profile')); // Expect 401

  const jsxSafe = await scanForJSXErrors();

  console.log('\n--- FINAL REPORT ---');
  console.log(`Frontend JSX Safe: ${jsxSafe ? '✅' : '❌'}`);
  console.log(`API Connectivity: ${results.every(r => r) ? '✅' : '❌'}`);

  if (!jsxSafe) process.exit(1);
}

run().catch(console.error);
