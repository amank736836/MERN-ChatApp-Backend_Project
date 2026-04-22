import { google } from "@ai-sdk/google";
import { streamText } from "ai";
import { v4 as uuid } from "uuid";
import { ErrorHandler, TryCatch } from "../middlewares/error.js";
import chatModel from "../models/chat.models.js";
import messageModel from "../models/message.models.js";
import userModel from "../models/user.models.js";
import {
  ALERT,
  NEW_MESSAGE,
  NEW_MESSAGE_ALERT,
  REFETCH_CHATS,
} from "../utils/events.js";
import {
  deleteFilesFromCloudinary,
  emitEvent,
  uploadFilesToCloudinary,
} from "../utils/features.js";

const newGroupChat = TryCatch(async (req, res, next) => {
  const { name, otherMembers } = req.body;

  if (!name) return next(new ErrorHandler("Group name is required", 400));

  if (!otherMembers || otherMembers.length === 0)
    return next(new ErrorHandler("Group members are required", 400));

  const members = [...otherMembers, req.userId];

  const chat = await chatModel.create({
    name,
    members,
    groupChat: true,
    creator: req.userId,
  });

  emitEvent(req, ALERT, members, {
    chatId: chat._id,
    message: `Welcome to ${name} group chat`,
  });

  emitEvent(req, REFETCH_CHATS, otherMembers);

  messageModel.create({
    chat: chat._id,
    content: `Welcome to ${name} group chat`,
    sender: req.userId,
  });

  return res.status(201).json({
    success: true,
    message: "Group chat created successfully",
  });
});

const getMyChats = TryCatch(async (req, res, next) => {
  if (!req.userId)
    return next(new ErrorHandler("Login to access this resource", 401));

  const chats = await chatModel
    .find({ members: req.userId })
    .populate("members", "name avatar")
    .sort({ updatedAt: -1 });

  const transformedChats = chats.map(({ _id, name, members, groupChat }) => {
    let otherMember = null;
    if (_id.toString() !== req.userId) {
      otherMember = members.find(
        (member) => member._id.toString() !== req.userId
      );
    } else {
      otherMember = members[0];
    }

    return {
      _id,
      name: groupChat ? name : otherMember?.name,
      groupChat,
      avatar: groupChat
        ? members.slice(0, 3).map(({ avatar }) => avatar.url)
        : [otherMember.avatar.url],
      members: members.reduce((acc, member) => {
        if (member._id.toString() !== req.userId) {
          acc.push(member._id);
        }
        return acc;
      }, []),
    };
  });

  return res.status(200).json({
    success: true,
    message: "Chats fetched successfully",
    chats: transformedChats,
  });
});

const getMyGroups = TryCatch(async (req, res, next) => {
  if (!req.userId)
    return next(new ErrorHandler("Login to access this resource", 401));

  const chats = await chatModel
    .find({
      members: req.userId,
      groupChat: true,
      creator: req.userId,
    })
    .populate("members", "name avatar")
    .sort({ updatedAt: -1 });

  const groups = chats.map(({ _id, name, groupChat, members }) => ({
    _id,
    name,
    groupChat,
    avatar: members.slice(0, 3).map(({ avatar }) => avatar.url),
    members: members.map(({ _id }) => _id),
  }));

  return res.status(200).json({
    success: true,
    message: "Groups fetched successfully",
    groups,
  });
});

const addGroupMembers = TryCatch(async (req, res, next) => {
  const { chatId, members } = req.body;

  if (!chatId) {
    return next(new ErrorHandler("Chat ID is required", 400));
  }

  if (!members) {
    return next(new ErrorHandler("Members are required", 400));
  }

  if (members.length < 1) {
    return next(new ErrorHandler("At least one member is required", 400));
  }

  const chat = await chatModel.findById(chatId);

  if (!chat) {
    return next(new ErrorHandler("Chat not found", 404));
  }

  if (!chat.groupChat) {
    return next(new ErrorHandler("Not a group chat", 400));
  }

  if (chat.creator.toString() !== req.userId.toString()) {
    return next(new ErrorHandler(`Only creator can add members`, 403));
  }

  const allNewMembersPromise = members.map((member) =>
    userModel.findById(member, "name")
  );

  const allNewMembers = await Promise.all(allNewMembersPromise);

  const uniqueMembers = allNewMembers.map(({ _id }) => _id);

  if (uniqueMembers.length < 1) {
    return next(
      new ErrorHandler(
        "Please select members that are not already in the group",
        400
      )
    );
  }

  chat.members.push(...uniqueMembers);

  if (chat.members.length > 100) {
    return next(new ErrorHandler("Group chat can have max 100 members", 400));
  }

  await chat.save();

  const allUsersName = allNewMembers.map(({ name }) => name).join(",");

  emitEvent(req, ALERT, chat.members, {
    chatId,
    message: `${allUsersName} has been added in the group`,
  });

  messageModel.create({
    chat: chatId,
    content: `${allUsersName} has been added in the group`,
    sender: req.userId,
  });

  emitEvent(req, REFETCH_CHATS, uniqueMembers);

  return res.status(200).json({
    success: true,
    message: "Members added successfully",
  });
});

const removeMember = TryCatch(async (req, res, next) => {
  const { chatId, memberId } = req.body;

  if (!chatId) {
    return next(new ErrorHandler("Chat ID is required", 400));
  }

  if (!memberId) {
    return next(new ErrorHandler("Member ID is required", 400));
  }

  const [chat, userThatWillBeRemoved] = await Promise.all([
    chatModel.findById(chatId),
    userModel.findById(memberId, "name"),
  ]);

  if (!chat) {
    return next(new ErrorHandler("Chat not found", 404));
  }

  if (!userThatWillBeRemoved) {
    return next(new ErrorHandler("User not found", 404));
  }

  if (!chat.groupChat) {
    return next(new ErrorHandler("Not a group chat", 400));
  }

  if (chat.creator.toString() !== req.userId.toString()) {
    return next(new ErrorHandler(`Only creator can remove members`, 403));
  }

  if (!chat.members.includes(memberId)) {
    return next(new ErrorHandler("User not in the group", 400));
  }

  if (chat.members.length < 2) {
    return next(
      new ErrorHandler("Group chat must have at least 1 members", 400)
    );
  }

  chat.members = chat.members.filter(
    (member) => member.toString() !== memberId.toString()
  );

  await chat.save();

  emitEvent(req, ALERT, chat.members, {
    chatId,
    message: `User ${userThatWillBeRemoved.name} has been removed from the group`,
  });

  emitEvent(req, REFETCH_CHATS, [memberId]);

  messageModel.create({
    chat: chatId,
    content: `User ${userThatWillBeRemoved.name} has been removed from the group`,
    sender: req.userId,
  });

  return res.status(200).json({
    success: true,
    message: "Member removed successfully",
  });
});

const leaveGroup = TryCatch(async (req, res, next) => {
  const { chatId } = req.body;

  if (!chatId) {
    return next(new ErrorHandler("Chat ID is required", 400));
  }

  const chat = await chatModel.findById(chatId);

  if (!chat) {
    return next(new ErrorHandler("Chat not found", 404));
  }

  if (!chat.groupChat) {
    return next(new ErrorHandler("Not a group chat", 400));
  }

  if (!chat.members.includes(req.userId)) {
    return next(new ErrorHandler("User not in the group", 400));
  }

  const otherMembers = chat.members.filter(
    (member) => member.toString() !== req.userId.toString()
  );
  chat.members = otherMembers;

  if (chat.creator.toString() === req.userId.toString()) {
    const randomCreator = Math.floor(Math.random() * otherMembers.length);
    chat.creator = otherMembers[randomCreator] || "";
  }
  const [user] = await Promise.all([
    userModel.findById(req.userId, "name"),
    chat.save(),
  ]);

  emitEvent(req, ALERT, otherMembers, {
    chatId,
    message: `${user.name}, I am leaving the group`,
  });

  messageModel.create({
    chat: chatId,
    content: `${user.name}, I am leaving the group`,
    sender: req.userId,
  });

  emitEvent(req, REFETCH_CHATS, [req.userId]);

  return res.status(200).json({
    success: true,
    message: "Left group successfully",
  });
});

const sendAttachments = TryCatch(async (req, res, next) => {
  const { chatId } = req.body;

  if (!chatId) {
    return next(new ErrorHandler("Chat ID is required", 400));
  }

  if (!req.userId) {
    return next(new ErrorHandler("Login to access this resource", 401));
  }

  const files = req.files || [];

  if (files.length < 1) {
    return next(new ErrorHandler("Please attach files", 400));
  }

  if (files.length > 5) {
    return next(new ErrorHandler("You can attach max 5 files", 400));
  }

  const [chat, user] = await Promise.all([
    chatModel.findById(chatId),
    userModel.findById(req.userId, "name"),
  ]);

  if (!chat) {
    return next(new ErrorHandler("Chat not found", 404));
  }

  if (!chat.members.includes(req.userId)) {
    return next(new ErrorHandler("User not in the group", 400));
  }

  const attachments = await uploadFilesToCloudinary(files);

  const messageForDB = {
    chat: chatId,
    content: "",
    attachments,
    sender: req.userId,
  };

  const messageForRealTime = {
    ...messageForDB,
    sender: {
      _id: req.userId,
      name: user.name,
    },
    _id: uuid(),
    createdAt: new Date().toISOString(),
  };

  const message = await messageModel.create(messageForDB);

  emitEvent(req, NEW_MESSAGE, chat.members, {
    message: messageForRealTime,
    chatId,
  });

  emitEvent(req, NEW_MESSAGE_ALERT, chat.members, { chatId });

  return res.status(200).json({
    success: true,
    message,
  });
});

const getChatDetails = TryCatch(async (req, res, next) => {
  const { chatId } = req.params;

  if (!chatId) {
    return next(new ErrorHandler("Chat ID is required", 400));
  }

  if (req.query.populate === "true") {
    const chat = await chatModel
      .findById(chatId)
      .populate("members", "name avatar")
      .lean();

    if (!chat) {
      return next(new ErrorHandler("Chat not found", 404));
    }

    chat.members = chat.members.map(({ _id, name, avatar }) => ({
      _id,
      name,
      avatar: avatar.url,
    }));

    return res.status(200).json({
      success: true,
      message: "Chat details fetched successfully with members",
      chat,
    });
  } else {
    const chat = await chatModel.findById(chatId);

    if (!chat) {
      return next(new ErrorHandler("Chat not found", 404));
    }

    return res.status(200).json({
      success: true,
      message: "Chat details fetched successfully",
      chat,
    });
  }
});

const renameGroup = TryCatch(async (req, res, next) => {
  const { chatId } = req.params;
  const { name } = req.body;

  if (!chatId) {
    return next(new ErrorHandler("Chat ID is required", 400));
  }

  if (!name) {
    return next(new ErrorHandler("Group name is required", 400));
  }

  const chat = await chatModel.findById(chatId);

  if (!chat) {
    return next(new ErrorHandler("Chat not found", 404));
  }

  if (!chat.groupChat) {
    return next(new ErrorHandler("Not a group chat", 400));
  }

  if (chat.creator.toString() !== req.userId.toString()) {
    return next(new ErrorHandler(`Only creator can rename group`, 403));
  }

  chat.name = name;

  await chat.save();

  messageModel.create({
    chat: chatId,
    content: `Group name changed from ${chat.name} to ${name}`,
    sender: req.userId,
  });

  emitEvent(req, REFETCH_CHATS, chat.members);

  return res.status(200).json({
    success: true,
    message: "Group name changed successfully",
  });
});

const deleteChat = TryCatch(async (req, res, next) => {
  const { chatId } = req.params;

  if (!chatId) {
    return next(new ErrorHandler("Chat ID is required", 400));
  }

  const chat = await chatModel.findById(chatId);

  if (!chat) {
    return next(new ErrorHandler("Chat not found", 404));
  }

  if (chat.groupChat && chat.creator.toString() !== req.userId.toString()) {
    return next(new ErrorHandler(`Only creator can delete group`, 403));
  }

  if (!chat.groupChat && !chat.members.includes(req.userId)) {
    return next(new ErrorHandler(`You are not a member of this chat`, 403));
  }

  const messageWithAttachments = await messageModel.find({
    chat: chatId,
    attachments: { $exists: true, $ne: [] },
  });

  const public_Ids = messageWithAttachments.map((message) =>
    message.attachments.map(({ public_id }) => public_id)
  );

  const members = chat.members;

  await Promise.all([
    deleteFilesFromCloudinary(public_Ids),
    chat.deleteOne(),
    messageModel.deleteMany({ chat: chatId }),
  ]);

  emitEvent(req, REFETCH_CHATS, members);

  return res.status(200).json({
    success: true,
    message: "Chat deleted successfully",
  });
});

const getMessages = TryCatch(async (req, res, next) => {
  const { chatId } = req.params;

  const { page = 1 } = req.query;

  if (!chatId) {
    return next(new ErrorHandler("Chat ID is required", 400));
  }

  const limit = 20;

  const skip = (page - 1) * limit;

  const chat = await chatModel.findById(chatId);

  if (!chat) {
    return next(new ErrorHandler("Chat not found", 404));
  }

  if (!chat.members.includes(req.userId.toString())) {
    return next(new ErrorHandler("User not in the chat", 400));
  }

  const [messages, totalMessagesCount] = await Promise.all([
    messageModel
      .find({
        chat: chatId,
      })
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(skip)
      .populate("sender", "name")
      .lean(),
    messageModel.countDocuments({
      chat: chatId,
    }),
  ]);

  if (chatId === req.userId) {
    messages.forEach((message) => {
      message.sender = {
        ...message.sender,
        name: "Anonymous",
      };
    });
  }

  const totalPages = Math.ceil(totalMessagesCount / limit) || 1;

  return res.status(200).json({
    success: true,
    message: "Messages fetched successfully",
    messages: messages.reverse(),
    totalPages,
  });
});

const suggestMessages = TryCatch(async (req, res, next) => {
  const { exclude = "" } = req.body;

  const prompt = `Create a list of three open-ended and engaging questions formatted as a single string.
    Each question should be separated by '||'. The questions are for an anonymous social messaging platform,
    and should be suitable for a diverse audience. Avoid personal or sensitive topics.
    Ensure the questions are intriguing and foster curiosity.
    DO NOT INCLUDE any of the following questions: ${exclude || "None"}.
    Each question MUST be at most 100 characters long.`;

  const { textStream } = await streamText({
    model: google("gemini-1.5-flash-8b-latest"),
    prompt: prompt,
    maxRetries: 3,
  });

  if (!textStream) {
    return res.status(500).json({
      success: false,
      message: "Failed to generate questions. Please try again.",
    });
  }

  let result = "";
  for await (const delta of textStream) {
    result += delta;
  }

  return res.status(200).json({
    success: true,
    message: result,
  });
});

const sendMessage = TryCatch(async (req, res, next) => {
  const { username, content, sender, replyTo } = req.body;

  if (!username) {
    return next(new ErrorHandler("Username is required", 400));
  }

  if (!content) {
    return next(new ErrorHandler("Message content is required", 400));
  }

  const user = await userModel.findOne({ username });

  if (!user) {
    return next(new ErrorHandler("User not found", 404));
  }

  if (!user.isAcceptingMessage) {
    return next(new ErrorHandler("User is not accepting messages", 400));
  }

  const chat = await chatModel.findById(user._id);

  if (!chat) {
    return next(new ErrorHandler("Chat not found", 404));
  }

  const existingChat = await chatModel.findOne({
    members: { $all: [sender?._id, user._id] },
  });

  const messageForDB = {
    chat: existingChat ? existingChat._id : chat._id,
    content: content,
    sender: sender ? sender._id : user._id,
    attachments: [],
    replyTo: replyTo
      ? {
          senderName: replyTo.senderName || "",
          content: replyTo.content || "",
        }
      : undefined,
  };

  const messageForRealTime = {
    ...messageForDB,
    sender: {
      _id: sender ? sender._id : user._id,
      name: "Anonymous",
    },
    _id: uuid(),
    createdAt: new Date().toISOString(),
  };

  const message = await messageModel.create(messageForDB);

  if (existingChat) {
    emitEvent(req, NEW_MESSAGE, existingChat.members, {
      message: messageForRealTime,
      chatId: existingChat._id,
    });
  } else {
    emitEvent(req, NEW_MESSAGE, chat.members, {
      message: messageForRealTime,
      chatId: chat._id,
    });
  }

  return res.status(200).json({
    success: true,
    message: "Message sent successfully",
  });
});

export {
  addGroupMembers,
  deleteChat,
  getChatDetails,
  getMessages,
  getMyChats,
  getMyGroups,
  leaveGroup,
  newGroupChat,
  removeMember,
  renameGroup,
  sendAttachments,
  sendMessage,
  suggestMessages,
};
