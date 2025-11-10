# Flow402 Vendor Demo

## Local Development
- Install workspace dependencies with `pnpm install`.
- Build the TypeScript sources with `pnpm --filter vendor-demo build`.
- Run the server locally with `pnpm --filter vendor-demo dev` or start the compiled output with `pnpm --filter vendor-demo start`.

## DigitalOcean App Platform
1. Create a new App Platform service and point it at this repository.
2. In the “Source” tab, set the working directory to `apps/vendor-demo`.
3. Use Node.js 20 or later.
4. Configure the build command as `corepack enable && pnpm install --no-frozen-lockfile && pnpm run build`.
5. Configure the run command as `pnpm run start`.
6. Add the `GATEWAY_DEDUCT_URL` environment variable pointing at your Flow402 gateway endpoint along with `FLOW402_VENDOR_KEY` and `FLOW402_SIGNING_SECRET` copied from the Supabase `tenants` row (the secret is used to sign `x-f402-sig`, the key identifies the vendor).

Once deployed the health check endpoint is available at `/` and the demo endpoint at `/demo/screenshot`.
