'use strict';

const axios = require('axios');
const fs = require('fs');
const winston = require('winston');
const TwitterClient = require('twitter-api-client').TwitterClient;
const { getMessageLocation } = require('./get-location');


require('dotenv').config();


const tenant = initArgs();
if (!tenant) {
    console.error('Couldn\'t load tenant configuration.');
    process.exit(1);
}

const tenantKey = tenant.key;
const baseUrl = `https://include-${tenant.providers.sue.system}.zfinder.de`;
const tenantBaseUrl = `${baseUrl}/mobileportalpms/${tenant.providers.sue.id}`;

const tenantsDir = './tenants';
const tenantDir = `${tenantsDir}/${tenantKey}`;
const imagesDir = `${tenantDir}/images`;
const tweetsDir = `${tenantDir}/tweets`;
const queueNewMessagesDir = `${tenantDir}/queue_new_messages`;
const queueResponseUpdatesDir = `${tenantDir}/queue_response_updates`;
const queueStatisticsUpdatesDir = `${tenantDir}/queue_statistics_updates`;

const logger = initLogger();
const twitterClient = initTwitterClient();

const LOG_TO_SLACK_CHANNEL = tenant.config.logToSlackChannel;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;


(async () => {

    try {

        prepareTenantDirectory();

        const processNewMessageResult = await popAndProcessNewMessage();
        if (!processNewMessageResult) {
            await popAndProcessResponseUpdate();
        }

        await popAndProcessStatisticsUpdate();

    } catch (e) {
        logError(e);
    }

})();


function initArgs() {

    const yargs = require('yargs/yargs');
    const { hideBin } = require('yargs/helpers');
    const argv = yargs(hideBin(process.argv))
        .options({
            'h': {
                alias: 'help'
            },
            't': {
                alias: 'tenant',
                demandOption: true,
                type: 'string',
            }
        })
        .coerce('tenant', arg => {
            const tenants = JSON.parse(fs.readFileSync('./tenants.json', 'utf-8'));
            return tenants.find(t => t.config.active && t.key === arg);
        })
        .version()
        .argv;

    return argv.tenant;

}


function initLogger() {

    return winston.createLogger({
        level: 'info',
        format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.errors({ stack: true }),
            winston.format.json()
        ),
        transports: [
            new winston.transports.File({ filename: `${tenantDir}/output-send-tweets.log` }),
            new winston.transports.Console({ format: winston.format.simple() })
        ]
    });

}


function prepareTenantDirectory() {
    if (!fs.existsSync(tweetsDir)) {
        logger.info('Creating tweets directory.')
        fs.mkdirSync(tweetsDir, { recursive: true });
    }
}


function initTwitterClient() {
    return new TwitterClient({
        apiKey: process.env.TWITTER_API_KEY,
        apiSecret: process.env.TWITTER_API_SECRET,
        accessToken: process.env.TWITTER_ACCESS_TOKEN,
        accessTokenSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET
    });
}


async function popAndProcessNewMessage() {

    const itemToProcess = fs
        .readdirSync(queueNewMessagesDir)
        .filter(f => f.startsWith('message-') && f.endsWith('.json'))
        .sort()
        .shift();

    if (itemToProcess) {

        logger.info(`Found new message to tweet: ${itemToProcess}`);

        const message = loadNewMessageFromQueue(itemToProcess);
        const imageData = message.messageImage ? loadImage(message) : null;
        await processNewMessage(message, imageData);

        removeItemFromNewMessagesQueue(itemToProcess);

    }

    return itemToProcess;

}


function loadNewMessageFromQueue(filename) {
    return JSON.parse(fs.readFileSync(`${queueNewMessagesDir}/${filename}`, 'utf-8'));
}


function loadImage(messageDetails) {
    logger.info(`Loading image of message "${messageDetails.id}"`);
    const mimeType = messageDetails.messageImage.mimeType;
    const fileExtension = mimeType === 'image/jpeg' ? '.jpeg' : (mimeType === 'image/png' ? '.png' : '');
    const filename = `${imagesDir}/${messageDetails.id}-${messageDetails.messageImage.id}${fileExtension}`;
    return fs.readFileSync(filename);
}


async function processNewMessage(message, imageData) {

    const localeOptions = { day: '2-digit', month: '2-digit', year: 'numeric' };
    const date = new Date(message.createdDate).toLocaleDateString('de-DE', localeOptions);
    const subject = message.subject.slice(0, imageData ? 224 : 234);
    const url = `${tenantBaseUrl}#meldungDetail?id=${message.id}`;

    let status = `${date}:

${subject}
${url}`;

    const location = getMessageLocation(message);

    if (imageData) {

        let mediaId = null;
        try {
            mediaId = await uploadImage(imageData);
        } catch (e) {
            return logFailedTweet(e);
        }

        status += `
Bild: LH Magdeburg`;

        try {
            const sendTweetResult = await sendNewMessageTweet(status, location, mediaId);
            saveMessageTweet(message, sendTweetResult);
        } catch(e) {
            return logFailedTweet(e);
        }

    } else {
        try {
            const sendTweetResult = await sendNewMessageTweet(status, location, null);
            saveMessageTweet(message, sendTweetResult);
        } catch(e) {
            return logFailedTweet(e);
        }
    }

}


async function uploadImage(imageDataBuffer) {

    logger.info('Uploading image to Twitter')

    return new Promise((resolve, reject) => {

        // noinspection JSCheckFunctionSignatures
        const base64 = imageDataBuffer.toString('base64');
        const uploadParams = { media_data: base64 };
        twitterClient.media
            .mediaUpload(uploadParams)
            .then(uploadResult => {
                logger.info('Image successfully sent to Twitter')
                resolve(uploadResult.media_id_string);
            })
            .catch(reject);

    });

}


async function sendNewMessageTweet(status, location, mediaId) {

    logger.info('Sending tweet...');
    logger.info(`...with status "${status}"`)
    if (mediaId) {
        logger.info(`...with media "${mediaId}"`)
    }

    const display_coordinates = !!location && location.length === 2;
    if (display_coordinates) {
        logger.info(`...with coordinate lat="${location[1]}" long="${location[0]}"`);
    }

    return new Promise((resolve, reject) => {
        const parameters = display_coordinates
            ? { status, display_coordinates, lat: location[1], long: location[0], media_ids: mediaId }
            : { status, media_ids: mediaId };
        twitterClient.tweets
            .statusesUpdate(parameters)
            .then(sendResult => {
                logger.info(`Tweet successfully sent. id = ${sendResult.id_str}`)
                resolve(sendResult);
            })
            .catch(reject);
    });

}


function removeItemFromNewMessagesQueue(filename) {
    logger.info(`Removing item "${filename}" from new messages queue`)
    fs.unlinkSync(`${queueNewMessagesDir}/${filename}`)
}


async function popAndProcessResponseUpdate() {

    const itemToProcess = fs
        .readdirSync(queueResponseUpdatesDir)
        .filter(f => f.startsWith('message-') && f.endsWith('.json'))
        .sort()
        .shift();

    if (itemToProcess) {

        logger.info(`Found response update to tweet: ${itemToProcess}`);

        const message = loadResponseUpdateFromQueue(itemToProcess);
        const tweets = loadTweets(message);
        const lastTweet = tweets.pop();
        if (lastTweet) {
            await processResponseUpdate(message, lastTweet.id_str);
        } else {
            logger.warn(`Didn't send response update tweet for message "${itemToProcess}", because origin tweet couldn't be found.`);
        }

        removeItemFromResponseUpdatesQueue(itemToProcess);

    }

    return itemToProcess;

}


function loadResponseUpdateFromQueue(filename) {
    return JSON.parse(fs.readFileSync(`${queueResponseUpdatesDir}/${filename}`, 'utf-8'));
}


async function processResponseUpdate(message, replyToId) {

    const response = message.responses.sort((a, b) => b.messageDate - a.messageDate)[0];
    const localeOptions = { day: '2-digit', month: '2-digit', year: 'numeric' };
    const date = new Date(response.messageDate).toLocaleDateString('de-DE', localeOptions);
    const responseText = response.message.length > 265 ? `${response.message.slice(0, 260)}[...]` : response.message;
    let status = `${date}:

"${responseText}"`;

    const location = getMessageLocation(message);

    try {
        const sendTweetResult = await sendUpdateTweet(status, location, replyToId);
        saveMessageTweet(message, sendTweetResult);
    } catch(e) {
        return logFailedTweet(e);
    }

}


function removeItemFromResponseUpdatesQueue(filename) {
    logger.info(`Removing item "${filename}" from response updates queue`)
    fs.unlinkSync(`${queueResponseUpdatesDir}/${filename}`)
}


async function popAndProcessStatisticsUpdate() {

    const itemToProcess = fs
        .readdirSync(queueStatisticsUpdatesDir)
        .filter(f => f.startsWith('stats-') && f.endsWith('.txt'))
        .sort()
        .shift();

    if (itemToProcess) {

        logger.info(`Found statistics update to tweet: ${itemToProcess}`);

        const text = loadStatisticsUpdateFromQueue(itemToProcess);
        await processStatisticsUpdate(text);

        removeItemFromStatisticsUpdatesQueue(itemToProcess);

    }

    return itemToProcess;

}


function loadStatisticsUpdateFromQueue(filename) {
    return fs.readFileSync(`${queueStatisticsUpdatesDir}/${filename}`, 'utf-8');
}


async function processStatisticsUpdate(text, date) {
    try {
        const sendTweetResult = await sendUpdateTweet(text, false, null, null);
        saveStatisticsTweet(text, sendTweetResult);
    } catch(e) {
        return logFailedTweet(e);
    }
}


function removeItemFromStatisticsUpdatesQueue(filename) {
    logger.info(`Removing item "${filename}" from statistics updates queue`)
    fs.unlinkSync(`${queueStatisticsUpdatesDir}/${filename}`)
}


function loadTweets(message) {
    const filename = `${tweetsDir}/tweets-${message.id}.json`;
    return fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, 'utf-8')) : [];
}


function saveMessageTweet(message, tweetResult) {
    const filename = `${tweetsDir}/tweets-${message.id}.json`;
    const tweets = fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, 'utf-8')) : [];
    tweets.push(tweetResult);
    const tweetResultStr = JSON.stringify(tweets, null, 2);
    fs.writeFileSync(filename, tweetResultStr);
}


function saveStatisticsTweet(text, tweetResult) {
    const filename = `${tweetsDir}/weekly-stats.json`;
    const tweets = fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, 'utf-8')) : [];
    tweets.push(tweetResult);
    const tweetResultStr = JSON.stringify(tweets, null, 2);
    fs.writeFileSync(filename, tweetResultStr);
}


async function sendUpdateTweet(status, location, replyToId) {

    logger.info('Sending tweet...');
    logger.info(`...with status "${status}"`)

    const display_coordinates = !!location && location.length === 2;
    if (display_coordinates) {
        logger.info(`...with coordinate lat="${location[1]}" long="${location[0]}"`);
    }

    return new Promise((resolve, reject) => {
        const parameters = display_coordinates
            ? { status, display_coordinates, lat: location[1], long: location[0], in_reply_to_status_id: replyToId }
            : { status, in_reply_to_status_id: replyToId };
        twitterClient.tweets
            .statusesUpdate(parameters)
            .then(sendResult => {
                logger.info(`Tweet successfully sent. id = ${sendResult.id_str}`)
                resolve(sendResult);
            })
            .catch(reject);
    });

}


function logError(error) {
    const text = `ERROR: ${error}`;
    logger.info(text)
    if (LOG_TO_SLACK_CHANNEL) {
        sendToSlackChannel(text);
    }
}


function logFailedTweet(error) {
    const text = 'Sending tweet failed';
    logger.error(text, error);
    if (LOG_TO_SLACK_CHANNEL) {
        sendToSlackChannel(text);
    }
}


function sendToSlackChannel(message) {
    const text = `${tenantKey}: ${message}`;
    const strData = JSON.stringify({ text });
    axios
        .post(SLACK_WEBHOOK_URL, strData)
        .catch(e => console.error(e));
}
