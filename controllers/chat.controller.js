import { google } from "@ai-sdk/google";
import { streamText } from "ai";
import { v4 as uuid } from "uuid";
import { ErrorHandler, TryCatch } from "../middlewares/error.js";
import chatModel from "../models/chat.models.js";
import messageModel from "../models/message.models.js";
import suggestedQuestionModel from "../models/suggestedQuestion.models.js";
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
  getSockets,
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

const normalizeQuestion = (value = "") =>
  value
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

const GLOBAL_SEED_QUESTIONS = [
  "What is something small that made your day better recently?",
  "If you could instantly learn one skill, what would it be and why?",
  "What kind of conversation helps you feel most understood?",
  "What is one goal you are currently working toward?",
  "What helps you recharge after a stressful day?",
  "What motivates you when you feel stuck?",
  "If you could relive one day from last year, which day would it be?",
  "What is one thing people often misunderstand about you?",
  "What is your ideal weekend like from start to finish?",
  "What is a fear you have overcome recently?",
  "If you could travel anywhere this year, where would you go first?",
  "What habit has improved your life the most?",
];

const ensureGlobalSeeds = async () => {
  const operations = GLOBAL_SEED_QUESTIONS.map((question) => {
    const normalized = normalizeQuestion(question);

    return {
      updateOne: {
        filter: { targetUsername: null, normalizedQuestion: normalized },
        update: {
          $setOnInsert: {
            targetUsername: null,
            question,
            normalizedQuestion: normalized,
            askedCount: 0,
            answer: "",
            answeredAt: null,
          },
        },
        upsert: true,
      },
    };
  });

  try {
    await suggestedQuestionModel.bulkWrite(operations, { ordered: false });
  } catch (error) {
    const hasOnlyDupErrors =
      Array.isArray(error?.writeErrors) &&
      error.writeErrors.length > 0 &&
      error.writeErrors.every((item) => item?.code === 11000);

    if (!hasOnlyDupErrors) {
      throw error;
    }
  }
};

const storeAndDeliverMessage = async ({ req, username, content, sender, replyTo }) => {
  const user = await userModel.findOne({ username });

  if (!user) {
    throw new ErrorHandler("User not found", 404);
  }

  if (!user.isAcceptingMessage) {
    throw new ErrorHandler("User is not accepting messages", 400);
  }

  let chatId = null;
  let targetMembers = [user._id];

  if (sender?._id) {
    const existingChat = await chatModel.findOne({
      groupChat: false,
      members: { $all: [sender._id, user._id] },
    });

    if (existingChat) {
      chatId = existingChat._id;
      targetMembers = existingChat.members;
    } else {
      const newChat = await chatModel.create({
        name: `${user.name}`,
        groupChat: false,
        members: [sender._id, user._id],
      });
      chatId = newChat._id;
      targetMembers = newChat.members;
    }
  } else {
    let userChat = await chatModel.findOne({
      groupChat: false,
      members: [user._id],
      name: `${user.name} - Messages`,
    });

    if (!userChat) {
      userChat = await chatModel.create({
        name: `${user.name} - Messages`,
        groupChat: false,
        members: [user._id],
      });
    }

    chatId = userChat._id;
    targetMembers = [user._id];
  }

  const messageForDB = {
    chat: chatId,
    content,
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
      name: sender ? sender.name : "Anonymous",
    },
    _id: uuid(),
    createdAt: new Date().toISOString(),
  };

  const message = await messageModel.create(messageForDB);

  const receiverSocketId = getSockets([user._id])[0];
  const receiverIsActive = Boolean(receiverSocketId);

  if (receiverIsActive) {
    emitEvent(req, NEW_MESSAGE, targetMembers, {
      message: messageForRealTime,
      chatId: messageForDB.chat,
    });

    emitEvent(req, NEW_MESSAGE_ALERT, targetMembers, {
      chatId: messageForDB.chat,
    });
  }

  return {
    message,
    realtimeDelivered: receiverIsActive,
  };
};

const askAndRecord = TryCatch(async (req, res, next) => {
  const { username, question, content, sender, replyTo } = req.body;

  const normalizedUsername = (username || "").trim().toLowerCase();
  const trimmedQuestion = (question || "").trim();
  const trimmedContent = (content || "").trim();

  if (!normalizedUsername || !trimmedQuestion || !trimmedContent) {
    return next(
      new ErrorHandler("username, question, and content are required", 400)
    );
  }

  await ensureGlobalSeeds();

  const normalizedQuestion = normalizeQuestion(trimmedQuestion);

  let existing;
  try {
    existing = await suggestedQuestionModel.findOneAndUpdate(
      { targetUsername: normalizedUsername, normalizedQuestion },
      {
        $setOnInsert: {
          targetUsername: normalizedUsername,
          question: trimmedQuestion,
          normalizedQuestion,
          answer: "",
          answeredAt: null,
        },
        $inc: { askedCount: 1 },
      },
      { upsert: true, new: true }
    );
  } catch (error) {
    const duplicateError = error?.code === 11000;
    if (!duplicateError) {
      throw error;
    }

    existing = await suggestedQuestionModel.findOneAndUpdate(
      { targetUsername: normalizedUsername, normalizedQuestion },
      { $inc: { askedCount: 1 } },
      { new: true }
    );
  }

  if (!existing) {
    existing = await suggestedQuestionModel.findOne({
      targetUsername: normalizedUsername,
      normalizedQuestion,
    });
  }

  const alreadyAnswered = Boolean(existing?.answer?.trim());
  const answeredQuestion = alreadyAnswered ? existing.question : null;
  const answeredAnswer = alreadyAnswered ? existing.answer : null;

  let messageSent = false;
  let realtimeDelivered = false;

  if (!alreadyAnswered) {
    const deliveryResult = await storeAndDeliverMessage({
      req,
      username: normalizedUsername,
      content: trimmedContent,
      sender,
      replyTo,
    });

    messageSent = Boolean(deliveryResult?.message?._id);
    realtimeDelivered = Boolean(deliveryResult?.realtimeDelivered);
  }

  return res.status(200).json({
    success: true,
    alreadyAnswered,
    answeredQuestion,
    answeredAnswer,
    messageSent,
    realtimeDelivered,
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

  const deliveryResult = await storeAndDeliverMessage({
    req,
    username: (username || "").trim().toLowerCase(),
    content,
    sender,
    replyTo,
  });

  return res.status(200).json({
    success: true,
    message: "Message sent successfully",
    messageStored: Boolean(deliveryResult?.message?._id),
    realtimeDelivered: Boolean(deliveryResult?.realtimeDelivered),
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
  askAndRecord,
  removeMember,
  renameGroup,
  sendAttachments,
  sendMessage,
  suggestMessages,
};
