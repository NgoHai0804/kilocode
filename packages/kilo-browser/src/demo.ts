import { start } from "../test/fixture/app/index"

const server = start(Number(process.env.PORT ?? 3000))
console.log(`Kilo Browser fixture app: http://127.0.0.1:${server.port}/login`)
console.log("Next: bun run src/cli.ts start --workspace <your-app>")
console.log("Then open the extension side panel and enter the pairing code printed by the bridge.")
