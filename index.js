let githubhook = require("githubhook");
let ellipsize = require("ellipsize");
let Telegram = require("node-telegram-bot-api");
let yargs = require("yargs");
let path = require("path");
let os = require("os");
let fs = require("fs");

let argv = yargs
  .usage("Usage: $0 [options]")

  .alias("c", "config")
  .describe("c", "Use config from given path")

  .alias("h", "help")
  .help()
  .strict().argv;

let configPath = argv.c || path.join(__dirname, `config.js`);
try {
  const config = require(configPath);
  let START_STR =
    "Ok, I will be sending you updates from the following GitHub repo: ";
  START_STR += config.git.reponame;

  let STOP_STR = "Ok, I will no longer be sending you GitHub updates.";

  let github = githubhook(config.git);

  let tg = new Telegram(config.telegram.token, { polling: true });

  let tgChats = [];

  let chatsPath = configPath + ".chatIds.json";
  try {
    console.log(
      "Attempting to restore group chat IDs from " + chatsPath + "..."
    );
    tgChats = require(chatsPath);
    console.log("Successfully restored group chat IDs.");
  } catch (e) {
    console.log("Error while reading from " + chatsPath + ":");
    console.log(e);

    console.log(
      "\nNot restoring group chat IDs. You MUST greet the bot with the /start"
    );
    console.log(
      "command in each group chat where you want it to send any github events."
    );
  }

  let writeTgChats = async () => {
    await fs.writeFileSync(chatsPath, JSON.stringify(tgChats));
  };

  tg.on("message", async msg => {
    // ignore non message events
    if (!msg.text) {
      return;
    }

    let chatId = msg.chat.id;
    if (!msg.text.indexOf("/start")) {
      if (tgChats.indexOf(chatId) === -1) {
        tgChats.push(chatId);
        await writeTgChats();
        await tg.sendMessage(chatId, START_STR);
      }
    } else if (!msg.text.indexOf("/stop")) {
      let chatIndex = tgChats.indexOf(chatId);
      if (chatIndex !== -1) {
        tgChats.splice(chatIndex, 1);
        await writeTgChats();
        await tg.sendMessage(chatId, STOP_STR);
      }
    }
  });

  let escapeMd = async text => {
    // make sure we're dealing with a string
    text = text.toString();

    // Telegram Bot API supports *_[]()` markdown control characters
    let specialChars = new RegExp("([\\\\`*_\\[]){1}", "g");

    return text.replace(specialChars, match => {
      return "\\" + match;
    });
  };

  let sendTg = async msg => {
    console.log("Sending to Telegram: " + msg);

    await tgChats.forEach(async chatId => {
      await tg.sendMessage(chatId, msg, {
        disable_web_page_preview: true,
        parse_mode: "Markdown"
      });
    });
  };

  github.on("push:" + config.git.reponame, async (ref, data) => {
    // don't care about branch deletes
    if (!data.commits.length) {
      return;
    }

    let s =
      "[" +
      escapeMd(data.after.substr(0, 8)) +
      "](" +
      escapeMd(data.compare) +
      ")";

    s +=
      ": " +
      escapeMd(data.pusher.name) +
      ", (" +
      escapeMd(data.pusher.email) +
      ")";
    s += " pushed " + data.commits.length;
    s +=
      " " + (data.commits.length === 1 ? "commit" : "commits") + " to " + ref;

    if (data.commits.length === 1) {
      s += ": " + escapeMd(data.commits[0].message) + "";
    }

    await sendTg(s);
  });

  github.on("pull_request:" + config.git.reponame, async (ref, data) => {
    let s = "[Pull request #";

    s += escapeMd(data.number);
    s += "](" + escapeMd(data.pull_request.html_url) + ")";

    s += " (" + escapeMd(data.pull_request.title) + ")";

    s += " " + escapeMd(data.action);
    s += " by " + escapeMd(data.sender.login);

    await sendTg(s);
  });

  github.on("issues:" + config.git.reponame, async (ref, data) => {
    let s = "[Issue #";

    s += escapeMd(data.issue.number);
    s += "](" + escapeMd(data.issue.html_url) + ")";

    s += " (" + escapeMd(data.issue.title) + ")";
    s += " " + escapeMd(data.action);

    if (data.action === "unassigned") {
      s += " from " + escapeMd(data.assignee.login);
    } else if (data.action === "assigned") {
      s += " to " + escapeMd(data.assignee.login);
    }

    s += " by " + escapeMd(data.sender.login);

    await sendTg(s);
  });

  github.on("issue_comment:" + config.git.reponame, async (ref, data) => {
    let s = escapeMd(data.sender.login) + " commented on [";
    s += data.issue.pull_request ? "pull request" : "issue";
    s += " #";
    s += escapeMd(data.issue.number);
    s += "](" + escapeMd(data.comment.html_url) + ")";

    s += " (" + escapeMd(data.issue.title) + "): ";

    s += escapeMd(ellipsize(data.comment.body, 120));

    await sendTg(s);
  });

  github.listen();
  
} catch (e) {
  console.log(`Exception caught while loading config file:`);
  console.log(e);

  console.log("\nPlease make sure the config file exists in " + configPath);
  console.log(
    "\nSee https://github.com/iamonuwa/github-telegram-webhook/blob/master/config.example.js"
  );
  console.log("for an example config file.");
  process.exit(1);
}
