const https = require('https');
const fs = require('fs');
const util = require('util');
const request = require('request');
const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const google = require('googleapis');
const gmail = google.gmail('v1');
const Queue = require('promise-queue');
const addrs = require("email-addresses");
const authorize = require('./authorize');
const {
  ssl_config_path: SSL_CONFIG_PATH,
  verify_token: VERIFY_TOKEN,
  token: ACCESS_TOKEN,
  white_list: WHITE_LIST,
  sender_list: SENDER_LIST,
  label_id: LABEL_ID,
  port: PORT
} = require('./.config.json');
const CONFIG = require(SSL_CONFIG_PATH);

// 為每位白名單用戶建立 Promise 佇列，
// 因為 messenger API 並不一定會按照發送順序顯示訊息，
// 所以必須確定訊息 Response 後才發下一則。
for (const id in WHITE_LIST) {
  WHITE_LIST[id].queue = new Queue(1, Infinity);
}

// 取消註解來啟動 request 套件的 debug 模式。
// require('request').debug = true;

// 授權實例 (全域)。
var auth;

// 取得最新的 history ID 記錄。
var latestHistoryId;
try {
  latestHistoryId = fs.readFileSync('latestHistoryId', 'utf8');
} catch (err) {}

console.info('初始化完成，最新的 history Id 為 ' + latestHistoryId);

app.use(bodyParser.json());

// 給 Google Cloud Platform cloudpubsub 用的 webhook。
app.post('/', function(req, res) {
  res.send('Hello World!');
  const body = req.body;
  const msg = body.message;
  var data = JSON.parse(Buffer.from(msg.data, 'base64').toString());
  return listHistory(data.historyId)
    .then((history) => {
      if (history) {
        return Promise.all(history.map((event) =>
          getMessage(event.messages[0].id)));
      } else {
        console.warn('Empty history.');
        return [];
      }
    })
    .then((messages) =>
      messages.forEach((msg) => {
        // 在 header 中尋找 寄件者 (From)。
        const from = msg.payload.headers.find((header) => header.name === 'From');

        if (!from)
          return void 0;

        // 剖析找出郵件地址。
        const senderInstance = addrs.parseOneAddress({
          input: from.value
        });

        // 如果有剖析出地址。
        if (senderInstance) {
          const sender = senderInstance.address;

          // 檢查寄件者是否在白名單內。
          const isSenderValid = !!SENDER_LIST.find((validSender) => validSender === sender);

          // 如果在白名單內。
          if (isSenderValid) {
            // 取得並解碼信件內容。
            const content = base64Decode(msg.payload.body.data);

            // 向每位用戶傳送通知。
            for (const id in WHITE_LIST) {
              const user = WHITE_LIST[id];
              user.queue.add(() => send(id, `收到來自 ${sender} 的信件：`));
              user.queue.add(() => send(id, content))
                .catch((err) => console.error(err));
            }
          }
        }
      }))
    .catch((err) => console.error(err));
});

// 給 Messenger platform 的驗證 webhook。
app.get('/messenger', function(req, res) {
  console.info('Messenger Webhook', 'verify');
  if (req.query['hub.verify_token'] === VERIFY_TOKEN)
    return res.send(req.query['hub.challenge']);
  res.send('Error, wrong validation token');
});

// 給 Messenger platform 的接收訊息 webhook。
app.post('/messenger', function(req, res) {
  req.body.entry.forEach((entry) => {
    const messagingEvents = entry.messaging;
    messagingEvents.forEach((event) => {
      console.info(event);
    });
  });
  res.send('OK');
});

// 設定 https 伺服器。
const
  server = https.createServer({
      key: fs.readFileSync(CONFIG.key),
      cert: fs.readFileSync(CONFIG.cert),
      ca: fs.readFileSync(CONFIG.ca),
    },
    app);

/**
 * 取得 gmail history 的資訊。
 * @params {Number} historyId - history ID。
 * @see https://developers.google.com/gmail/api/v1/reference/users/history/list
 */
function listHistory(historyId) {
  const list = util.promisify(gmail.users.history.list);
  return list({
      auth,
      userId: 'me',
      historyTypes: 'messageAdded',
      labelId: LABEL_ID,
      startHistoryId: latestHistoryId || '676902'
    })
    .then((response) => {
      // 記下原本是否有 latestHistoryId。
      const noOriginHistoryId = !latestHistoryId;

      // 記下最新的 history Id。
      latestHistoryId = historyId;

      // 存檔。
      fs.writeFile('latestHistoryId', latestHistoryId, 'utf8', () => {});

      // 如果沒有舊 history ID，這次只取最新一筆的 history。
      // 避免通知一堆舊信件。
      return (noOriginHistoryId) ? response.history.slice(-1) : response.history;
    });
}

/**
 * 取得 gmail message 的資訊。
 * @params {Number} messageId - message ID。
 * @see https://developers.google.com/gmail/api/v1/reference/users/messages/get
 */
function getMessage(messageId) {
  var gmail = google.gmail('v1');
  return util.promisify(gmail.users.messages.get)({
    auth,
    id: messageId,
    userId: 'me',
  });
}

/**
 * 初始化 Google API 授權，以及建立 https 伺服器。
 * @params {Number} id - psid，用戶對於這個粉專的專屬 ID。
 * @params {String} text - 傳送的文字內容。 
 * @return {Promise<Object>} Request 的 body。
 */
function send(id, text) {
  return new Promise((resolve, reject) =>
    request({
      uri: 'https://graph.facebook.com/v2.9/me/messages',
      method: 'POST',
      qs: {
        access_token: ACCESS_TOKEN
      },
      json: {
        recipient: {
          id
        },
        message: {
          text
        },
      }
    }, (err, res = {}, body = {}) => {
      if (err || res.statusCode !== 200 || typeof body !== 'object' || body.error) {
        const rejectResult = [err, res.statusCode, body];
        console.error(...rejectResult);
        return reject(rejectResult);
      }

      return resolve(body);
    }));
}

/**
 * 解碼 base64。
 * @params {String} b64string - base64 字串。
 * @return {String} 被解碼的字串。
 */
function base64Decode(b64string) {
  return new Buffer(b64string, 'base64').toString();
}

/**
 * 初始化 Google API 授權，以及建立 https 伺服器。
 */
Promise.all([
    authorize(),
    new Promise((resolve, reject) =>
      server.listen(PORT, () =>
        resolve()))
  ])
  .then(([authClient]) => {
    auth = authClient;
  })
  .catch((err) => {
    console.error(err);
  });
