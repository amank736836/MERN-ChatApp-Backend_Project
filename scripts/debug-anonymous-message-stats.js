import { config as envConfig } from "dotenv";
import mongoose from "mongoose";
import chatModel from "../models/chat.models.js";
import messageModel from "../models/message.models.js";

envConfig({ path: "./.env" });

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error("MONGODB_URI is not defined in environment variables.");
  process.exit(1);
}

const main = async () => {
  await mongoose.connect(MONGODB_URI, { dbName: "StealthyNote" });

  const singleChats = await chatModel
    .find({ groupChat: false, members: { $size: 1 } })
    .select("_id")
    .lean();

  const singleIds = singleChats.map((chat) => chat._id);

  const totalAnon = await messageModel.countDocuments({ isAnonymous: true });
  const anonInSingle = await messageModel.countDocuments({
    isAnonymous: true,
    chat: { $in: singleIds },
  });
  const anonReplies = await messageModel.countDocuments({
    isAnonymous: true,
    "replyTo.content": { $nin: [null, ""] },
  });
  const orphanAnonResult = await messageModel.aggregate([
    { $match: { isAnonymous: true } },
    {
      $lookup: {
        from: "chats",
        localField: "chat",
        foreignField: "_id",
        as: "chatDoc",
      },
    },
    { $match: { chatDoc: { $size: 0 } } },
    { $count: "count" },
  ]);

  const legacyNoFlag = await messageModel.countDocuments({
    isAnonymous: { $exists: false },
  });

  console.log(
    JSON.stringify(
      {
        totalAnon,
        anonInSingle,
        anonReplies,
        orphanAnon: orphanAnonResult[0]?.count || 0,
        legacyNoFlag,
        singleInboxChats: singleIds.length,
      },
      null,
      2
    )
  );

  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error("Failed to compute anonymous message stats:", error?.message || error);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore disconnect errors
  }
  process.exit(1);
});
