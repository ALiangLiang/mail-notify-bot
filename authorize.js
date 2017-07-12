/**
 * Google API 的授權程序。
 * @see https://developers.google.com/gmail/api/quickstart/nodejs
 */
module.exports = function() {
  var fs = require('fs');
  var readline = require('readline');
  var googleAuth = require('google-auth-library');

  var SCOPES = [
    'https://mail.google.com/',
    'https://www.googleapis.com/auth/gmail.readonly',
  ];
  var TOKEN_DIR = (process.env.HOME || process.env.HOMEPATH ||
    process.env.USERPROFILE) + '/.credentials/';
  var TOKEN_PATH = TOKEN_DIR + 'gmail-nodejs-quickstart.json';

  function authorize(credentials) {
    return new Promise((resolve, reject) => {
      var clientSecret = credentials.installed.client_secret;
      var clientId = credentials.installed.client_id;
      var redirectUrl = credentials.installed.redirect_uris[0];
      var auth = new googleAuth();
      var oauth2Client = new auth.OAuth2(clientId, clientSecret, redirectUrl);

      // Check if we have previously stored a token.
      fs.readFile(TOKEN_PATH, function(err, token) {
        if (err) {
          return getNewToken(oauth2Client);
        } else {
          oauth2Client.credentials = JSON.parse(token);
          return resolve(oauth2Client);
        }
      });
    });
  }

  function getNewToken(oauth2Client) {
    return new Promise((resolve, reject) => {
      var authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES
      });
      console.log('Authorize this app by visiting this url: ', authUrl);
      var rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      rl.question('Enter the code from that page here: ', function(code) {
        rl.close();
        oauth2Client.getToken(code, function(err, token) {
          if (err) {
            console.log('Error while trying to retrieve access token', err);
            return reject(err);
          }
          oauth2Client.credentials = token;
          storeToken(token);
          return resolve(oauth2Client);
        });
      });
    });
  }


  function storeToken(token) {
    try {
      fs.mkdirSync(TOKEN_DIR);
    } catch (err) {
      if (err.code != 'EEXIST') {
        throw err;
      }
    }
    fs.writeFile(TOKEN_PATH, JSON.stringify(token));
    console.log('Token stored to ' + TOKEN_PATH);
  }

    const content = require('./client_secret.json');
    return authorize(content);
};
