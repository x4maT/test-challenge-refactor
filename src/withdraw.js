const db = require('./database');
const config = require('./config');

let minEarnText = `You must earn at least ${config.withdraw.minEarnedToWithdraw} coins ($${(
  config.withdraw.minEarnedToWithdraw / 1000
).toFixed(
  2
)}) through the offer walls before withdrawing.<br>This is to prevent abuse of the site bonuses. Please contact staff with any questions.`;

module.exports = {
  onsiteGiftcardWithdraw: function (socket, socketuser) {
    return function (data) {
      let feedbackType = '';

      function feedback(feedback) {
        socket.emit('withdrawFeedback', feedback, feedbackType);
      }

      if (!data) return feedback(`An unknown error occurred`);

      let type = data.type;
      let coinAmount = parseInt(data.coinAmount);
      let countryCode = data.countryCode || 'WW';

      feedbackType = type;

      if (
        type != 'Fortnite' &&
        type != 'Visa' &&
        type != 'Amazon' &&
        type != 'Steam' &&
        type != 'Roblox'
      ) {
        return feedback(`An error occurred. Please try refreshing.`);
      }
      if (
        countryCode != 'US' &&
        countryCode != 'UK' &&
        countryCode != 'CA' &&
        countryCode != 'DE' &&
        countryCode != 'FR' &&
        countryCode != 'AU' &&
        countryCode != 'WW'
      ) {
        return feedback(`An error occurred. Please try refreshing.`);
      }

      if (!socketuser) return feedback(`Please login to withdraw!`);
      if (!type) return feedback(`An error occurred. Please try refreshing.`);

      if (isNaN(coinAmount) || !coinAmount) {
        return feedback(`Please select an amount!`);
      }

      db.getAccountStanding(socketuser.gainid, (err, standing) => {
        if (err) {
          console.error(err);

          return feedback(`An error occurred, please try again`);
        }
        if (standing.banned || standing.frozen) {
          return feedback(
            `You are currently banned from withdrawing, please contact staff if you believe this is a mistake.`
          );
        }
        db.isDefaultUserEmailVerified(socketuser.gainid, (err, isEmailVerified) => {
          if (err) {
            console.error(err);

            return feedback(`An error occurred, please try again`);
          }
          if (!isEmailVerified) {
            return feedback(`You must verify your E-mail address before requesting a withdrawal!`);
          }
          db.getBalanceByGainId(socketuser.gainid, (err, balance) => {
            if (err) {
              console.error(err);
              return feedback(`An error occurred, please try again`);
            }

            if (balance < coinAmount) {
              return feedback(`You don't have enough balance!`);
            }

            db.earnedEnoughToWithdraw(socketuser.gainid, (err, earnedEnoughBool) => {
              if (err) {
                console.error(err);
                let feedbackText = `An error occurred, please try again.`;
                return feedback(feedbackText);
              }

              if (!earnedEnoughBool) {
                return feedback(minEarnText);
              }

              return GiftcardService.isGiftCardInStock(type, coinAmount, countryCode)
                .then((result) => {
                  // if it's on stock continue as usual
                  if (result) return notVerified();
                  // otherwise, tell the user to pick another card.
                  return feedback(`This card is currently out of stock. Please choose another.`);
                })
                .catch((err) => {
                  // if there's an error, it can't be determined if the card is in stock or not
                  console.error(err);
                  return notVerified();
                });
            });

            function notVerified(outOfStock) {
              db.updateBalanceByGainId(socketuser.gainid, coinAmount * -1, (err) => {
                if (err) {
                  console.error(err);
                  return feedback(`An error occurred, please try again`);
                }
                db.insertPendingSiteGiftCardWithdraw(
                  socketuser.gainid,
                  coinAmount,
                  type,
                  countryCode,
                  utils.getIsoString(),
                  null,
                  (err, result) => {
                    if (err) {
                      console.error(err);
                      return feedback(`An error occurred, please try again`);
                    }

                    socket.emit('withdrawalPending', {
                      coins: coinAmount,
                    });

                    Notifications.storeNotification(
                      socketuser.gainid,
                      'Info',
                      'pendingwithdrawal',
                      `Your ${type} Gift Card withdrawal worth ${coinAmount} coins is pending.`
                    );

                    if (outOfStock) {
                      feedback(
                        `Success!<br>This card is currently out of stock. A staff member will approve your withdrawal when it is restocked.`
                      );
                    } else {
                      feedback(
                        `Success!<br>Since you are not verified, a staff member has been notified and will review your withdrawal shortly! Check your Profile page to view your redemption code after the withdrawal has been approved.<br><br>Have an opinion on our site? Share it by <a href="https://trustpilot.com/evaluate/freecash.com" target="_blank">writing a Trustpilot review</a>!`
                      );
                    }

                    emitBalance(socketuser.gainid);
                  }
                );
              });
            }
          });
        });
      });
    };
  },
};
