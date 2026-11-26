"use strict";
// Passwords are hashed with scrypt (slow and memory-hard), so a stolen database
// is not a stolen set of passwords. Only Node's built-in crypto is used.

const crypto = require("node:crypto");
const { Users, Sessions } = require("./db");

const KEYLEN = 64;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
// Used when an email isn't found, so a wrong email takes as long as a wrong password
const DUMMY = { pw_salt: "00".repeat(16), pw_hash: "00".repeat(KEYLEN) };

const hash = (password, salt) => crypto.scryptSync(String(password), salt, KEYLEN, SCRYPT).toString("hex");

function makeHash(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  return { salt, hash: hash(password, salt) };
}

function verify(password, user) {
  const u = user || DUMMY;
  const attempt = Buffer.from(hash(password, u.pw_salt), "hex");
  const stored = Buffer.from(u.pw_hash, "hex");
  return !!user && attempt.length === stored.length && crypto.timingSafeEqual(attempt, stored);
}

function passwordProblem(pw) {
  pw = String(pw || "");
  if (pw.length < 10) return "Password must be at least 10 characters.";
  if (pw.length > 200) return "Password is too long.";
  if (/^\d+$/.test(pw)) return "Password can't be only numbers.";
  return null;
}

function register(email, name, password) {
  email = String(email || "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 200) throw new Error("Enter a valid email address.");
  if (!String(name || "").trim()) throw new Error("Enter your name.");
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  if (Users.byEmail(email)) throw new Error("That email already has an account. Sign in instead.");
  const h = makeHash(password);
  const user = Users.create(email, name, h.hash, h.salt);
  return { user, token: Sessions.create(user.id) };
}

function login(email, password) {
  const user = Users.byEmail(email || "");
  if (!verify(password, user)) return null;
  return { user, token: Sessions.create(user.id) };
}

module.exports = { register, login };
