import path from 'node:path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // PGlite, the supabase mock, and the harness use Node-only APIs (fs, wasm).
  // Mark them external so Next doesn't try to bundle them.
  serverExternalPackages: ['@electric-sql/pglite', '@supabase/supabase-js'],
  // Silence the "multiple lockfiles" warning by pinning the workspace root.
  outputFileTracingRoot: path.resolve('./')
};

export default nextConfig;
