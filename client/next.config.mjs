import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ['127.0.0.1', '127.0.0.1:3000', 'localhost', 'localhost:3000'],
  env: {
    NEXT_PUBLIC_GOOGLE_CLIENT_ID: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '',
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || process.env.VITE_API_URL || '',
    VITE_GOOGLE_CLIENT_ID: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '',
    VITE_API_URL: process.env.NEXT_PUBLIC_API_URL || process.env.VITE_API_URL || '',
  },
  turbopack: {
    resolveAlias: {
      'react-router-dom': './src/router-bridge.tsx',
    },
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      'react-router-dom': path.resolve(__dirname, 'src/router-bridge.tsx'),
    };
    return config;
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: process.env.NODE_ENV === 'development'
          ? `${process.env.INTERNAL_API_ORIGIN || 'http://127.0.0.1:3001'}/api/:path*`
          : '/api/:path*',
      },
    ];
  },
};

export default nextConfig;
