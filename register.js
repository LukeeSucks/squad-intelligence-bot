// Adds/updates the bot's slash commands with Discord straight away.
// The bot also does this by itself when it starts, so this is only needed if
// you want to force it:  node register.js
// Needs DISCORD_TOKEN and DISCORD_APPLICATION_ID (environment or .env file).
import { registerCommands } from "./src/discord.js";

registerCommands({ force: true })
  .then((result) => console.log(`Slash commands: ${result}`))
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
