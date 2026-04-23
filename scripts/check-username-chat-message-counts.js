import { config as envConfig } from "dotenv";
import mongoose from "mongoose";
import userModel from "../models/user.models.js";
import chatModel from "../models/chat.models.js";
import messageModel from "../models/message.models.js";

envConfig({ path: "./.env" });

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error("MONGODB_URI is not defined in environment variables.");
  process.exit(1);
}

const usernameArg = (process.argv[2] || "").trim().toLowerCase();

const main = async () => {
  await mongoose.connect(MONGODB_URI, { dbName: "StealthyNote" });

  const userFilter = usernameArg ? { username: usernameArg } : {};
  const users = await userModel.find(userFilter, "_id username name").lean();

  if (users.length === 0) {
    console.log(usernameArg ? `No user found for username: ${usernameArg}` : "No users found.");
    await mongoose.disconnect();
    return;
  }

  const results = [];

  for (const user of users) {
    const chat = await chatModel.findById(user._id).select("_id name groupChat members").lean();

    if (!chat) {
      results.push({
        username: user.username,
        chatFound: false,
        messageCount: 0,
      });
      continue;
    }

    const messageCount = await messageModel.countDocuments({ chat: chat._id });

    results.push({
      username: user.username,
      chatFound: true,
      chatId: String(chat._id),
      chatName: chat.name,
      groupChat: chat.groupChat,
      memberCount: Array.isArray(chat.members) ? chat.members.length : 0,
      messageCount,
    });
  }

  console.log(JSON.stringify(results, null, 2));

  const summary = {
    usersChecked: results.length,
    chatsFound: results.filter((item) => item.chatFound).length,
    totalMessages: results.reduce((sum, item) => sum + (item.messageCount || 0), 0),
  };

  console.log("SUMMARY=" + JSON.stringify(summary));

  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error("Failed to check username chat message counts:", error?.message || error);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore disconnect errors
  }
  process.exit(1);
});
