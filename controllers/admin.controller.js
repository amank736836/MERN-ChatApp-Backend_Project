import jwt from "jsonwebtoken";
import { ADMIN_SECRET_KEY, cookieOptions, JWT_SECRET } from "../app.js";
import { ErrorHandler, TryCatch } from "../middlewares/error.js";
import chatModel from "../models/chat.models.js";
import messageModel from "../models/message.models.js";
import userModel from "../models/user.models.js";

const adminLogin = TryCatch(async (req, res, next) => {
  const { secretKey } = req.body;

  if (!secretKey) {
    return next(new ErrorHandler("Please enter a secret key", 400));
  }

  const adminSecretKey = ADMIN_SECRET_KEY;
  const isMatch = secretKey === adminSecretKey;

  if (!isMatch) {
    return next(new ErrorHandler("Invalid Admin secret key", 401));
  }

  const token = jwt.sign({ secretKey }, JWT_SECRET, {
    expiresIn: "12h",
  });

  return res
    .status(200)
    .cookie("StealthyNoteAdminToken", token, {
      ...cookieOptions,
      maxAge: 1000 * 60 * 60 * 12,
    })
    .json({
      success: true,
      message: "Authenticated Admin Login Successfully",
    });
});

const adminLogout = TryCatch(async (req, res, next) => {
  res.cookie("StealthyNoteAdminToken", null, {
    ...cookieOptions,
    maxAge: 0,
  });

  return res.status(200).json({
    success: true,
    message: "Logged out successfully",
  });
});

const getAdminData = TryCatch(async (req, res, next) => {
  return res.status(200).json({
    success: true,
    message: "Welcome to Stealthy Note Admin Dashboard",
    admin: true,
  });
});

const allUsers = TryCatch(async (req, res, next) => {
  const users = await userModel.find({}).sort({ createdAt: -1 });

  const transformedUsers = await Promise.all(
    users.map(async ({ _id, name, avatar, email, username, createdAt }) => {
      const [friends, groups] = await Promise.all([
        chatModel.countDocuments({ groupChat: false, members: _id }),
        chatModel.countDocuments({ groupChat: true, members: _id }),
      ]);

      return {
        _id,
        avatar: avatar.url,
        name,
        email,
        username,
        friends,
        groups,
        createdAt,
      };
    })
  );

  return res.status(200).json({
    success: true,
    message: "All users",
    users: transformedUsers,
  });
});

const allChats = TryCatch(async (req, res, next) => {
  const chats = await chatModel
    .find({})
    .sort({ createdAt: -1 })
    .populate("members", "name avatar")
    .populate("creator", "name avatar");

  const transformedChats = await Promise.all(
    chats.map(async ({ _id, name, groupChat, members, creator }) => {
      const memberDetails = await Promise.all(
        members.map(async ({ _id, name, avatar: { url } }) => ({
          _id,
          name,
          avatar: url,
        }))
      );

      const totalMessages = await messageModel.countDocuments({
        chat: _id,
      });

      return {
        _id,
        name,
        groupChat,
        totalMessages,
        members: memberDetails,
        totalMembers: members.length,
        avatar: members.slice(0, 3).map((member) => member.avatar.url),
        creator: {
          _id: creator?._id || null,
          name: creator?.name || "None",
          avatar: creator?.avatar?.url || "",
        },
      };
    })
  );

  return res.status(200).json({
    success: true,
    message: "All chats",
    chats: transformedChats,
  });
});

const allMessages = TryCatch(async (req, res, next) => {
  const messages = await messageModel
    .find({})
    .sort({ createdAt: -1 })
    .populate("sender", "name avatar")
    .populate("chat", "groupChat");

  const transformedMessages = messages.map(
    ({ _id, content, sender, chat, attachments, createdAt }) => ({
      _id,
      content,
      attachments,
      createdAt,
      chat: chat._id,
      groupChat: chat.groupChat,
      sender: sender
        ? {
          _id: sender._id,
          name: sender.name,
          avatar: sender.avatar?.url || "",
        }
        : {
          _id: null,
          name: "Unknown",
          avatar: "",
        },
    })
  );

  return res.status(200).json({
    success: true,
    message: "All messages",
    messages: transformedMessages,
  });
});

const getDashboardStats = TryCatch(async (req, res, next) => {
  const [groupChatCount, totalUsers, totalChats, totalMessages] =
    await Promise.all([
      chatModel.countDocuments({ groupChat: true }),
      userModel.countDocuments(),
      chatModel.countDocuments(),
      messageModel.countDocuments(),
    ]);

  const today = new Date();

  const last7Days = new Date();
  last7Days.setDate(last7Days.getDate() - 7);

  const last7DaysMessages = await messageModel
    .find({
      createdAt: { $gte: last7Days, $lte: today },
    })
    .select("createdAt");

  const messages = new Array(7).fill(0);

  last7DaysMessages.forEach(({ createdAt }) => {
    const index = today.getDate() - createdAt.getDate();

    messages[6 - index]++;
  });

  const stats = {
    totalUsers,
    totalChats,
    totalMessages,
    groupChatCount,
    singleChatCount: totalChats - groupChatCount,
    last7DaysMessages: messages,
  };

  return res.status(200).json({
    success: true,
    message: "Dashboard stats",
    stats,
  });
});

export {
  adminLogin,
  adminLogout,
  allChats,
  allMessages,
  allUsers,
  getAdminData,
  getDashboardStats,
};
