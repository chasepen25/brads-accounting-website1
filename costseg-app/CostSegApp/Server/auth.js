"use strict";
// Passwords are hashed with scrypt, which is deliberately slow and memory-hard,
// so a stolen database is not a stolen set of passwords. No third-party library:
// Node's crypto module has everything needed.

const crypto = require("node:crypto");
const { Users, Sessions } = require("./db");

const KEYLEN = 64;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function hash(password, salt) {
  return crypto.scryptSync(String(password), salt, KEYLEN, SCRYPT).toString("hex");
}

function makeHash(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  return { salt: salt, hash: hash(password, salt) };
}

function verify(password, user) {
  if (!user) return false;
  const attempt = Buffer.from(hash(password, user.pw_salt), "hex");
  const stored = Buffer.from(user.pw_hash, "hex");
  // Constant-time compare, so response timing doesn't leak how close a guess was.
  return attempt.length === stored.length && crypto.timingSafeEqual(attempt, stored);
}

function passwordProblem(pw) {
  if (!pw || String(pw).length < 10) return "Password must be at least 10 characters.";
  if (/^\d+$/.test(pw)) return "Password can't be only digits.";
  return null;
}

function register(email, name, password) {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email || ""))) throw new Error("Enter a valid email address.");
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  if (Users.byEmail(email)) throw new Error("That email is already registered.");
  const h = makeHash(password);
  // The first account to register owns the instance.
  const role = Users.count() === 0 ? "owner" : "member";
  return Users.create(email, name, h.hash, h.salt, role);
}

function login(email, password) {
  const user = Users.byEmail(email);
  if (!verify(password, user)) return null;
  return { user: user, token: Sessions.create(user.id, 30) };
}

function changePassword(user, current, next) {
  if (!verify(current, user)) throw new Error("Current password is wrong.");
  const problem = passwordProblem(next);
  if (problem) throw new Error(problem);
  const h = makeHash(next);
  require("./db").db.prepare("UPDATE users SET pw_hash=?, pw_salt=? WHERE id=?")
    .run(h.hash, h.salt, user.id);
}

module.exports = { register, login, verify, makeHash, changePassword, passwordProblem };
