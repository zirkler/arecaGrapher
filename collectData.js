var fs = require('fs');
var readline = require('readline');
var google = require('googleapis');
var googleAuth = require('google-auth-library');
var async = require('async');
var MongoClient = require('mongodb').MongoClient;
var moment = require('moment');
var schedule = require('node-schedule');
var q = require('q');

var standalone = !module.parent;
var mongohost = 'localhost:27017';
var mongodb = 'backupDB';
var mongoConnection = 'mongodb://' + mongohost + '/' + mongodb;

var SCOPES = ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.modify'];
var TOKEN_DIR = (process.env.HOME || process.env.HOMEPATH || process.env.USERPROFILE) + '/.credentials/';
var TOKEN_PATH = TOKEN_DIR + 'gmail-api-quickstart.json';

var start = function() {
    // Load client secrets from a local file.
    fs.readFile('client_secret.json', function processClientSecrets(err, content) {
        if (err) {
            console.log('Error loading client secret file: ' + err);
            return;
        }

        // Authorize a client with the loaded credentials, then call the
        // Gmail API.
        // TODO: use fcall instead
        authorize(JSON.parse(content)).then(function(auth) {
            listBackupMails(auth);
        });

    });
};

/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 *
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
function authorize(credentials, callback) {
    var deferred = q.defer();
    var clientSecret = credentials.installed.client_secret;
    var clientId = credentials.installed.client_id;
    var redirectUrl = credentials.installed.redirect_uris[0];
    var auth = new googleAuth();
    var oauth2Client = new auth.OAuth2(clientId, clientSecret, redirectUrl);

    // Check if we have previously stored a token.
    fs.readFile(TOKEN_PATH, function(err, token) {
        if (err) {
            getNewToken().then(function(oauth2Client) {
                deferred.resolve(oauth2Client);
            });
        } else {
            oauth2Client.credentials = JSON.parse(token);
            deferred.resolve(oauth2Client);
        }
    });
    return deferred.promise;
}


/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized OAuth2 client.
 *
 * @param {google.auth.OAuth2} oauth2Client The OAuth2 client to get token for.
 * @param {getEventsCallback} callback The callback to call with the authorized
 *     client.
 */
function getNewToken(oauth2Client, callback) {
    var deferred = q.defer();
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
                return;
            }
            oauth2Client.credentials = token;
            storeToken(token);
            q.resolve(oauth2Client);
        });
    });
    return deferred.promise;
}

/**
 * Store token to disk be used in later program executions.
 *
 * @param {Object} token The token to store to disk.
 */
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


/*
    Get the latest 99 Mail IDs from Gmail.
*/
function listBackupMails(auth) {
    var gmail = google.gmail('v1');
    // get a list of all messages
    gmail.users.messages.list({
        auth: auth,
        userId: 'me',
        maxResults: 99,
        q: 'label:backup-notification'
    }, function(err, response) {
        var messages = response.messages;
        console.log(messages.length);
        async.eachLimit(messages, 5, function(message, cb) {
            var id = message.id;
            // get a specific message
            gmail.users.messages.get({
                auth: auth,
                userId: 'me',
                id: id
            }, function(err, message){
                processMessage(err, message, cb);
            });
        }, function() {
            // all emails saved, now parse them!
            console.log(new Date(), "loaded all mails.");
            parseMails();
        });
    });
}


/*
    This is called for every Mail.
*/
var processMessage = function(err, message, cb) {
    if (err) {
        console.log("Error: ", err);
        return;
    }
    var buf = new Buffer(message.payload.body.data, 'base64').toString('ascii');
    message._id = message.id;
    message.payload.body.plainText = buf;

    MongoClient.connect(mongoConnection, function(err, db) {
        if (!db) {
            console.log(err);
            return;
        }
        var collection = db.collection('mails');
        collection.updateOne(
            {_id: message._id},
            message,
            {upsert: true},
            function(err, result) {
                cb();
            }
        );
    });
};


/*
    Parse the collected mails and save them as "areca statistics objects" in our database.
*/
var parseMails = function() {
    MongoClient.connect(mongoConnection, function(err, db) {
        var mails = db.collection('mails');
        mails.find({}).each(function(err, mail) {

            if (mail === null) {
                console.log(new Date(), "finshed inserting");
                return;
            }

            var plainText = mail.payload.body.plainText;
            if (/Overall Status : Success/g.test(plainText)) {
                var backupDetails = {};
                backupDetails._id = mail._id;
                backupDetails.name = "-";
                backupDetails.targetId = 0;
                backupDetails.backupStartDate = null;
                backupDetails.backupEndDate = null;
                backupDetails.writtenKb = 0;
                backupDetails.numberOfSourceFiles = 0;
                backupDetails.sourceFilesSize = 0;
                backupDetails.numberOfArchives = 0;
                backupDetails.archivePhysicalSize = 0;
                backupDetails.physicalSizeRatio = 0;
                backupDetails.sizeWithoutHistory = 0;
                backupDetails.sizeOfHistory = 0;
                backupDetails.fileList = [];

                for (var i = 0; i < mail.payload.headers.length; i++) {
                    var header = mail.payload.headers[i];
                    // read areca target
                    if (header.name === "X-Areca-Target") backupDetails.targetId = header.value;

                    // read backupEndDate
                    if (header.name === "Date") backupDetails.backupEndDate = moment(Date.parse(header.value)).toISOString();
                }

                // get start date in a nice format
                var backupStartDateString = plainText.match(/(\) on)([.\s\S]*?)\n/g)[0].split("on")[1].trim();
                var startDateFormat = "";
                if (backupStartDateString.indexOf(".") != -1) {
                    // 23.06.2015 18:00
                    startDateFormat = "DD.MM.YYYY HH:mm";
                } else {
                    // Jun 23, 2015 9:33 AM
                    startDateFormat = "MMM DD, YYYY hh:mm A";
                }

                // extract properties
                backupDetails.name = plainText.match(/(^)([.\s\S]*?)(\()/g)[0].split("(")[0].trim();
                backupDetails.backupStartDate = moment(backupStartDateString, startDateFormat).toISOString();
                backupDetails.writtenKb = plainText.match(/(Written kbytes)([.\s\S]*?)\n/g)[0].split(":")[1].trim().replace(/\.|,/g, "");
                backupDetails.numberOfSourceFiles = plainText.match(/(\((NOF)\))([.\s\S]*?)\n/g)[0].split(" ")[2].trim().replace(/\.|,/g, "");
                backupDetails.numberOfArchives = plainText.match(/(\((NOA)\))([.\s\S]*?)\n/g)[0].split(" ")[2].trim().replace(/\.|,/g, "");
                backupDetails.archivePhysicalSize = plainText.match(/(\((APS)\))([.\s\S]*?)\n/g)[0].split(" ")[2].trim().replace(/\.|,/g, "");
                backupDetails.physicalSizeRatio = plainText.match(/(\((PSR)\))([.\s\S]*?)\n/g)[0].split(" ")[2].trim().replace(/\.|,/g, "");
                backupDetails.sizeWithoutHistory = plainText.match(/(\((SWH)\))([.\s\S]*?)\n/g)[0].split(" ")[2].trim().replace(/\.|,/g, "");
                backupDetails.sizeOfHistory = plainText.match(/(SOH)([.\s\S]*?)\n/g)[0].split(" ")[2].trim().replace(/\.|,/g, "");
                backupDetails.sourceFilesSize = plainText.match(/(\(SFS\))([.\s\S]*?)\n/g)[0].split(" ")[2].trim().replace(/\.|,/g, "");

                // read fileList
                if (backupDetails.writtenKb > 0) {
                    backupDetails.fileList = plainText.match(/(?:\[Beginning\])([.\s\S]*)\[End\]/g)[0].split("\r\n");
                    backupDetails.fileList.splice(0, 1);
                    backupDetails.fileList.splice(backupDetails.fileList.length-1, 1);
                }



                // save to database
                var collection = db.collection('backups');
                console.log(backupDetails._id);
                collection.updateOne(
                    {_id: backupDetails._id},
                    backupDetails,
                    {upsert: true},
                    function(err, result) {
                        if (err) console.log(err);
                    }
                );
            }
        });
    });
};

if (standalone) start();
module.exports = { start: start };
