import sharp from 'sharp';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, '..', 'public');

// SVG 아이콘 (ShieldCheck 기반)
const svgIcon = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="none">
  <!-- Background -->
  <rect width="512" height="512" rx="96" fill="#0f172a"/>

  <!-- Inner gradient background -->
  <rect x="32" y="32" width="448" height="448" rx="80" fill="#3b82f6"/>

  <!-- Shield with Check icon -->
  <g transform="translate(96, 64) scale(1.25)">
    <!-- Shield outline -->
    <path d="M128 16L24 56v80c0 88 44 170.4 104 213.3C188.2 306.4 232 224 232 136V56L128 16z"
          fill="none" stroke="white" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>
    <!-- Checkmark -->
    <path d="M88 160l28 28 52-52"
          fill="none" stroke="white" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>
`;

const sizes = [
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
  { name: 'apple-touch-icon.png', size: 180 },
  { name: 'favicon-32.png', size: 32 },
  { name: 'favicon-16.png', size: 16 },
];

async function generateIcons() {
  console.log('Generating PWA icons...');

  for (const { name, size } of sizes) {
    const outputPath = path.join(publicDir, name);

    await sharp(Buffer.from(svgIcon))
      .resize(size, size)
      .png()
      .toFile(outputPath);

    console.log(`✅ Generated ${name} (${size}x${size})`);
  }

  console.log('\\nAll icons generated successfully!');
}

generateIcons().catch(console.error);
