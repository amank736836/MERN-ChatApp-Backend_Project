import jwt from "jsonwebtoken";
import {
  ADMIN_SECRET_KEY,
  JWT_SECRET,
  STEALTHY_NOTE_ADMIN_TOKEN_NAME,
  STEALTHY_NOTE_TOKEN_NAME,
} from "../app.js";
import userModel from "../models/user.models.js";
import { ErrorHandler, TryCatch } from "./error.js";

const getTokenUserId = (decodedData) => decodedData?.id || decodedData?._id;

const isAuthenticated = TryCatch((req, res, next) => {
  const token = req.cookies[STEALTHY_NOTE_TOKEN_NAME];

  if (!token) {
    return next(new ErrorHandler("Please Login to access this resource", 401));
  }

  const decodedData = jwt.verify(token, JWT_SECRET);

  if (!decodedData) {
    return next(new ErrorHandler("Invalid Token", 401));
  }

  const userId = getTokenUserId(decodedData);

  if (!userId) {
    return next(new ErrorHandler("Invalid Token", 401));
  }

  req.userId = userId;

  next();
});

const isAdminAuthenticated = TryCatch((req, res, next) => {
  const token = req.cookies[STEALTHY_NOTE_ADMIN_TOKEN_NAME];

  if (!token) {
    return next(new ErrorHandler("Please Login to access this resource", 401));
  }

  const decodedData = jwt.verify(token, JWT_SECRET);

  if (!decodedData) {
    return next(new ErrorHandler("Invalid Token", 401));
  }

  const adminSecretKey = decodedData.secretKey;
  const isMatch = adminSecretKey === ADMIN_SECRET_KEY;

  if (!isMatch) {
    return next(new ErrorHandler("Invalid Admin secret key", 401));
  }

  next();
});

const isSocketAuthenticated = async (err, socket, next) => {
  if (err) {
    return next(
      new ErrorHandler(err?.message || "Socket authentication error", 401)
    );
  }

  try {
    const authToken = socket.request.cookies[STEALTHY_NOTE_TOKEN_NAME];

    if (!authToken) {
      return next(
        new ErrorHandler("Please Login to access this resource", 401)
      );
    }

    const decodedData = jwt.verify(authToken, JWT_SECRET);

    if (!decodedData) {
      return next(new ErrorHandler("Invalid Token", 401));
    }

    const userId = getTokenUserId(decodedData);

    if (!userId) {
      return next(new ErrorHandler("Invalid Token", 401));
    }

    const user = await userModel.findById(userId);

    if (!user) {
      return next(new ErrorHandler("User not found", 404));
    }

    socket.user = user;

    return next();
  } catch (error) {
    console.error(error);
    return next(
      new ErrorHandler(error?.message || "Socket authentication error", 401)
    );
  }
};

export { isAdminAuthenticated, isAuthenticated, isSocketAuthenticated };
