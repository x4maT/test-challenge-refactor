const mysql = require('promise-mysql'); // async mysql package.
import assert from 'better-assert';
import { get } from 'lodash';
import config from '../config';

class Database {
  // Call this when the server starts, wait for the connection to the database
  async initialize() {
    this.pool = await mysql.createPool(config.database);
    this.connection = await this.pool.getConnection();
  }

  async getAccountStanding(gainid) {
    const accountStanding = {
      banned: false,
      frozen: false,
      muted: false,
      countryBanned: false,
      deleted: false,
    };

    const result = await this.connection.query(
      `
      SELECT * FROM banned WHERE gainid = ?;
      SELECT * FROM frozen WHERE gainid = ?;
      SELECT * FROM muted WHERE gainid = ?;
      SELECT * FROM countrybanned WHERE gainid = ?;
      SELECT deleted FROM users WHERE gainid = ?;
    `,
      [gainid, gainid, gainid, gainid, gainid]
    );

    ['banned', 'frozen', 'muted', 'countryBanned'].map((item, index) => {
      accountStanding[item] = !!result[0].length;
    });

    if (result[4][0].deleted) {
      accountStanding.deleted = true;
    }

    return accountStanding;
  }

  async isDefaultUserEmailVerified(gainid) {
    const result = await this.connection.query(
      `SELECT email_confirmed FROM defaultusers WHERE gainid = '${gainid}'`
    );

    // idk how it should work, strange logic
    // I didn't change it
    return get(result, '0.email_confirmed', false) || !get(result, '0', false);
  }

  async isUserVerified(gainid) {
    // in the users table. The type of the column is a tinyint(1).
    // users or defaultusers?
    const result = await this.connection.query(
      `SELECT verified FROM users WHERE gainid = '${gainid}'`
    );

    return get(result, '0.verified', false);
  }

  async getBalanceByGainId(gainid) {
    const result = await this.connection.query(
      `SELECT balance FROM users WHERE gainid = '${gainid}'`
    );

    assert(result.length === 1);

    return result[0].balance;
  }

  async earnedEnoughToWithdraw(gainid) {
    const result = await this.connection.query(
      `
      SELECT SUM(coins) AS coins FROM (
        SELECT SUM(coins) AS coins FROM surveys WHERE gainid = ?
          UNION ALL
        SELECT SUM(coins) AS coins FROM videos WHERE gainid = ?
          UNION ALL
        SELECT SUM(coins) AS coins FROM refearnings WHERE gainid = ?
      ) AS f`,
      [gainid, gainid, gainid]
    );

    const userCoins = get(result, '0.coins');

    return !!userCoins && userCoins >= config.withdraw.minEarnedToWithdraw;
  }

  async updateBalanceByGainId(gainid, coinAmount) {
    const result = await this.connection.query(
      `UPDATE users SET balance = balance + ? WHERE gainid = ?`,
      [coinAmount, gainid]
    );

    assert(result.affectedRows === 1);

    const result2 = await this.connection.query(
      `INSERT INTO balance_movements (gainid, amount, new_balance) VALUES (, ?, (SELECT balance FROM users WHERE gainid = ?));`,
      [gainid, coinAmount, gainid]
    );

    assert(result2.affectedRows === 1);
  }

  async insertPendingSiteGiftCardWithdraw(
    gainid,
    coinAmount,
    cardType,
    countryCode,
    date,
    warningMessage
  ) {
    const result = await this.connection.query(
      `
      INSERT INTO pendingwithdraw (gainid, date, warning_message) VALUES (?, ?, ?);
      INSERT INTO pending_site_gift_card_withdraw (releaseid, coinamount, card_type, date, country_code) VALUES
      (LAST_INSERT_ID(), ?, ?, ?, ?, ?);
    `,
      [gainid, date, warningMessage, releaseid, coinAmount, cardType, date, countryCode]
    );

    assert(result.length === 2);

    return result;
  }

  async insertSiteGiftCardWithdrawal({
     gainid,
     coinAmount,
     cardCode,
     cardType,
     countryCode,
     date,
     approver,
   } = {}) {
    const result = await this.connection.query(
      `INSERT INTO withdraw (gainid, date, approver) VALUES (?, ?, ?);
        INSERT INTO site_gift_card_withdraw (withdrawid, coinamount, card_code, card_type, date, country_code) VALUES
        (LAST_INSERT_ID(), ?, ?, ?, ?, ?)`,
      [gainid, date, approver, coinAmount, cardCode, cardType, date, countryCode]
    );

    assert(result.length === 2);

    return result;
  }
}

export default new Database();
