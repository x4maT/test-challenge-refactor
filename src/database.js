const mysql = require('mysql');
const config = require('./config');
const assert = require('better-assert');
const Promise = require('bluebird');
const connection = mysql.createPool(config.database);

const db = {
  getAccountStanding: function (gainid, cb) {
    let sql = `
      SELECT * FROM banned WHERE gainid = ?;
      SELECT * FROM frozen WHERE gainid = ?;
      SELECT * FROM muted WHERE gainid = ?;
      SELECT * FROM countrybanned WHERE gainid = ?;
      SELECT deleted FROM users WHERE gainid = ?;
    `;
    connection.query(sql, [gainid, gainid, gainid, gainid, gainid, gainid], (err, result) => {
      if (err) return cb(err);

      let accountStanding = {
        banned: false,
        frozen: false,
        muted: false,
        countryBanned: false,
        deleted: false,
      };

      if (result[0].length) accountStanding.banned = true;
      if (result[1].length) accountStanding.frozen = true;
      if (result[2].length) accountStanding.muted = true;
      if (result[3].length) accountStanding.countryBanned = true;
      if (result[4][0].deleted) accountStanding.deleted = true;

      cb(null, accountStanding);
    });
  },
  isDefaultUserEmailVerified: function (gainid, cb) {
    const sql = `
        SELECT email_confirmed FROM defaultusers WHERE gainid = ?`;
    connection.query(sql, [gainid], (err, result) => {
      if (err) {
        return cb(err);
      }
      if (result && result[0] && result[0].email_confirmed) {
        return cb(null, true);
      } else if (!result[0]) {
        return cb(null, true);
      }
      cb(null, false);
    });
  },
  getBalanceByGainId: function (gainid, cb) {
    connection.query(`SELECT balance FROM users WHERE gainid = ?`, [gainid], (err, result) => {
      if (err) return cb(err);

      assert(result.length === 1);
      cb(null, result[0].balance);
    });
  },
  earnedEnoughToWithdraw: function (gainid, cb) {
    connection.query(
      `
      SELECT SUM(coins) AS coins FROM (
        SELECT SUM(coins) AS coins FROM surveys WHERE gainid = ?
          UNION ALL
        SELECT SUM(coins) AS coins FROM videos WHERE gainid = ?
          UNION ALL
        SELECT SUM(coins) AS coins FROM refearnings WHERE gainid = ?
      ) AS f
    `,
      [gainid, gainid, gainid],
      (err, result) => {
        if (err) return cb(err);

        if (result[0].coins && result[0].coins >= config.withdraw.minEarnedToWithdraw)
          return cb(null, true);

        cb(null, false);
      }
    );
  },
  updateBalanceByGainId: function (gainid, amount, cb) {
    connection.query(
      `UPDATE users SET balance = balance + ? WHERE gainid = ?`,
      [amount, gainid],
      (err, result) => {
        if (err) return cb(err);

        assert(result.affectedRows === 1);

        connection.query(
          `INSERT INTO balance_movements (gainid, amount, new_balance) VALUES (?, ?, (SELECT balance FROM users WHERE gainid = ?));`,
          [gainid, amount, gainid],
          (err, result) => {
            if (err) return cb(err);
            assert(result.affectedRows === 1);
            cb(null);
          }
        );
      }
    );
  },
  insertPendingSiteGiftCardWithdraw: function (
    gainid,
    coinAmount,
    cardType,
    countryCode,
    date,
    warningMessage,
    cb
  ) {
    let sql = `
      INSERT INTO pendingwithdraw (gainid, date, warning_message) VALUES (?, ?, ?);
      INSERT INTO pending_site_gift_card_withdraw (releaseid, coinamount, card_type, date, country_code) VALUES
      (LAST_INSERT_ID(), ?, ?, ?, ?);
    `;
    connection.query(
      sql,
      [gainid, date, warningMessage, coinAmount, cardType, date, countryCode],
      (err, result) => {
        if (err) return cb(err);

        assert(result.length === 2);
        cb(null, result);
      }
    );
  },
  insertSiteGiftCardWithdrawal: function (
    gainid,
    coinAmount,
    cardCode,
    cardType,
    countryCode,
    date,
    approver,
    cb
  ) {
    let sql = `
      INSERT INTO withdraw (gainid, date, approver) VALUES (?, ?, ?);
      INSERT INTO site_gift_card_withdraw (withdrawid, coinamount, card_code, card_type, date, country_code) VALUES
      (LAST_INSERT_ID(), ?, ?, ?, ?, ?)
    `;
    connection.query(
      sql,
      [gainid, date, approver, coinAmount, cardCode, cardType, date, countryCode],
      (err, result) => {
        if (err) return cb(err);

        assert(result.length === 2);
        cb(null, result);
      }
    );
  },
};

module.exports = Promise.promisifyAll(db) || db;