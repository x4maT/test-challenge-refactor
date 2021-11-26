import Database from './database';
import Notifications from './notifications';
import GiftcardService from './services/giftcard';
import config from '../config';

// Naturally we need a class(middleware) to handle and proceed errors/messages with additional logic.
const errorList = {
  BASE: 'An error occurred, please try again',
  UNKNOWN: 'An unknown error occurred',
  USER_NOT_AUTHORIZED: 'Please login to Withdraw!',
  USER_ACCOUNT_SUSPENDED:
    'You are currently banned from withdrawing, please contact staff if you believe this is a mistake.',
  USER_EMAIL_NOT_VERIFIED: 'You must verify your E-mail address before requesting a withdrawal!',
  USER_BALANCE_NOT_ENOUGH: "You don't have enough balance!",
  INCORRECT_COIN_AMOUNT: 'Please select an amount!',
  GIFT_CARD_OUT_OF_STOCK: 'This card is currently out of stock. Please choose another.',
};

const minEarnText = `You must earn at least ${config.withdraw.minEarnedToWithdraw} coins ($${(
  config.withdraw.minEarnedToWithdraw / 1000
).toFixed(
  2
)}) through the offer walls before withdrawing.<br>This is to prevent abuse of the site bonuses. Please contact staff with any questions.`;

class Withdraw {
  constructor(socket) {
    this.socket = socket;
    this.user = socket.request.user;

    if (!this.user.logged_in) {
      this.bindedGiftCardWithdrow = () => this.feedback(errorList.USER_NOT_AUTHORIZED);

      return;
    }

    this.bindedGiftCardWithdrow = this.onsiteGiftCardWithdraw.bind(this);
  }

  feedback(feedback) {
    this.socket.emit('withdrawFeedback', feedback, feedbackType);
  }

  async notVerified({ coinAmount, type, countryCode } = {}, outOfStock = null) {
    try {
      await Database.updateBalanceByGainId(this.user.gainid, coinAmount * -1);

      await Database.insertPendingSiteGiftCardWithdraw(
        this.user.gainid,
        coinAmount,
        type,
        countryCode,
        utils.getIsoString(),
        null
      );

      this.socket.emit('withdrawalPending', {
        coins: coinAmount,
      });

      Notifications.storeNotification(
        this.user.gainid,
        'Info',
        'pendingwithdrawal',
        `Your ${type} Gift Card withdrawal worth ${coinAmount} coins is pending.`
      );

      if (outOfStock) {
        this.feedback(
          `Success!<br>This card is currently out of stock. A staff member will approve your withdrawal when it is restocked.`
        );
      } else {
        this.feedback(
          `Success!<br>Since you are not verified, a staff member has been notified and will review your withdrawal shortly! Check your Profile page to view your redemption code after the withdrawal has been approved.<br><br>Have an opinion on our site? Share it by <a href="https://trustpilot.com/evaluate/freecash.com" target="_blank">writing a Trustpilot review</a>!`
        );
      }

      emitBalance(this.user.gainid);
    } catch (err) {
      console.error(err);

      return this.feedback(errorList.BASE);
    }
  }

  async checkAccountStanding() {
    try {
      const accountStanding = await Database.getAccountStanding(this.user.gainid);

      if (accountStanding.banned || accountStanding.frozen) {
        return this.feedback(errorList.USER_ACCOUNT_SUSPENDED);
      }
    } catch (err) {
      console.error(err);

      return this.feedback(errorList.BASE);
    }
  }

  async checkEmailVerification() {
    try {
      const isEmailVerified = await Database.isDefaultUserEmailVerified(this.user.gainid);

      if (!isEmailVerified) {
        return this.feedback(errorList.USER_EMAIL_NOT_VERIFIED);
      }
    } catch (err) {
      console.error(err);

      return this.feedback(errorList.BASE);
    }
  }

  async checkUserBalance(coinAmount) {
    try {
      const userBalance = await Database.getBalanceByGainId(this.user.gainid);

      if (userBalance < coinAmount) {
        return this.feedback(errorList.USER_BALANCE_NOT_ENOUGH);
      }
    } catch (err) {
      console.error(err);

      return this.feedback(errorList.BASE);
    }
  }

  async checkEarnedEnoughToWithdraw() {
    try {
      const earnedEnoughBool = await Database.earnedEnoughToWithdraw(this.user.gainid);

      if (!earnedEnoughBool) {
        return feedback(minEarnText);
      }
    } catch (err) {
      console.error(err);

      return this.feedback(errorList.BASE);
    }
  }

  async onsiteGiftCardWithdraw(data) {
    if (!data) {
      return this.feedback(errorList.UNKNOWN);
    }

    let { type, coinAmount, countryCode } = data;

    coinAmount = parseInt(coinAmount);
    countryCode = countryCode || 'WW';

    const serviceList = ['Fortnite', 'Visa', 'Amazon', 'Steam', 'Roblox'];
    const countryList = ['US', 'Uk', 'CA', 'DE', 'FR', 'AU', 'WW'];

    if (!serviceList.includes(countryCode) || !countryList.includes(countryCode) || !type) {
      return this.feedback(errorList.BASE);
    }

    if (isNaN(coinAmount) || !coinAmount) {
      return this.feedback(errorList.INCORRECT_COIN_AMOUNT);
    }

    await this.checkAccountStanding();
    await this.checkEmailVerification();
    await this.checkUserBalance(coinAmount);
    await this.checkEarnedEnoughToWithdraw();

    const isUserVerified = await Database.isUserVerified(this.user.gainid);

    if (isUserVerified) {
      try {
        const result = await GiftcardService.getGiftcard(type, coinAmount, countryCode);
        const { card_code: cardCode, card_type: cardType } = result;
        const date = utils.giftCardFormattedDate(); // localtime, utc etc.
        const approver = utils.getApprover(this.user.gainid);

        if (result) {
          await Database.insertSiteGiftCardWithdrawal({
            gainid,
            coinAmount,
            countryCode,
            cardCode,
            cardType,
            date,
            approver,
          });

          await Database.updateBalanceByGainId(this.user.gainid, coinAmount * -1);

          this.socket.emit('withdrawalSuccess', {
            coins: coinAmount,
          });

          return Notifications.storeNotification(
            this.user.gainid,
            'Info',
            'succeswithdrawal',
            `Your ${cardType} code: ${cardCode}, Gift Card withdrawal worth ${coinAmount} coins is successful.`
          );
        }
      } catch (err) {
        console.error(err);

        /* ROLLBACK IF ANYTHING FAILED */
        /* restore balance, GiftCardUnavailableError, error notification etc. */
        return this.giftCardWithdrawRollbackActions({
          gainid,
          coinAmount,
          countryCode,
          cardCode,
          cardType,
          date,
        });
      }
    } else {
      try {
        const result = await GiftcardService.isGiftCardInStock(type, coinAmount, countryCode);

        if (result) {
          return this.notVerified({
            coinAmount,
            type,
            countryCode,
          });
        }

        return this.feedback(errorList.GIFT_CARD_OUT_OF_STOCK);
      } catch (err) {
        console.error(err);

        return this.notVerified({
          coinAmount,
          type,
          countryCode,
        });
      }
    }
  }
}

export default Withdraw;
