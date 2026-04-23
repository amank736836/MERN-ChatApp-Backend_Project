import { config as envConfig } from "dotenv";
import mongoose from "mongoose";
import chatModel from "../models/chat.models.js";
import userModel from "../models/user.models.js";

envConfig({ path: "./.env" });

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error("MONGODB_URI is not defined in environment variables.");
  process.exit(1);
}

const main = async () => {
  await mongoose.connect(MONGODB_URI, { dbName: "StealthyNote" });

  const users = await userModel.find({}, "_id username").lean();

  if (users.length === 0) {
    console.log("No users found.");
    await mongoose.disconnect();
    return;
  }

  let created = 0;
  let updated = 0;

  for (const user of users) {
    const inboxName = `${user.username} - Messages`;

    let inboxChat = await chatModel.findById(user._id);

    if (!inboxChat) {
      inboxChat = await chatModel.findOne({
        groupChat: false,
        members: [user._id],
      });
    }

    if (!inboxChat) {
      await chatModel.create({
        _id: user._id,
        name: inboxName,
        groupChat: false,
        members: [user._id],
      });
      created += 1;
      continue;
    }

    let needsUpdate = false;

    if (String(inboxChat._id) !== String(user._id)) {
      // Keep stable route/id mapping by moving inbox to user._id
      await chatModel.deleteOne({ _id: inboxChat._id });
      await chatModel.create({
        _id: user._id,
        name: inboxName,
        groupChat: false,
        members: [user._id],
      });
      updated += 1;
      continue;
    }

    if (inboxChat.groupChat !== false) {
      inboxChat.groupChat = false;
      needsUpdate = true;
    }

    if (JSON.stringify(inboxChat.members.map(String)) !== JSON.stringify([String(user._id)])) {
      inboxChat.members = [user._id];
      needsUpdate = true;
    }

    if (inboxChat.name !== inboxName) {
      inboxChat.name = inboxName;
      needsUpdate = true;
    }

    if (needsUpdate) {
      await inboxChat.save();
      updated += 1;
    }
  }

  console.log(`Anonymous inbox ensured for users=${users.length}, created=${created}, updated=${updated}`);
  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error("Failed to ensure anonymous inbox chats:", error?.message || error);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore disconnect errors
  }
  process.exit(1);
});
