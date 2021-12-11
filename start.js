'use strict';


const https = require('https');
const fs = require('fs');
const TwitterClient = require('twitter-api-client').TwitterClient;
const proj4 = require('proj4');

require('dotenv').config();


const BASE_URL = process.env.BASE_URL;
const LIMIT_MESSAGES_SYNC = process.env.LIMIT_MESSAGES_SYNC;
const TWEET_DELAY_SECONDS = process.env.TWEET_DELAY_SECONDS;
const MAX_TWEETS_PER_RUN = process.env.MAX_TWEETS_PER_RUN;

const TWITTER_API_KEY = process.env.TWITTER_API_KEY;
const TWITTER_API_SECRET = process.env.TWITTER_API_SECRET;
const TWITTER_ACCESS_TOKEN = process.env.TWITTER_ACCESS_TOKEN;
const TWITTER_ACCESS_TOKEN_SECRET = process.env.TWITTER_ACCESS_TOKEN_SECRET;

const ARCHIVE_MESSAGES = process.env.ARCHIVE_MESSAGES === 'true';
const DO_THE_TWEETS = process.env.DO_THE_TWEETS === 'true';
const TWEET_WITH_IMAGE = process.env.TWEET_WITH_IMAGE === 'true';

const LOG_TO_SLACK_CHANNEL = process.env.LOG_TO_SLACK_CHANNEL === 'true';
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;


const twitterClient = new TwitterClient({
    apiKey: TWITTER_API_KEY,
    apiSecret: TWITTER_API_SECRET,
    accessToken: TWITTER_ACCESS_TOKEN,
    accessTokenSecret: TWITTER_ACCESS_TOKEN_SECRET,
});


proj4.defs([
    ['EPSG:4326', '+title=WGS 84 (long/lat) +proj=longlat +ellps=WGS84 +datum=WGS84 +units=degrees'],
    ['EPSG:25832', '+proj=utm +zone=32 +ellps=GRS80 +units=m +no_defs ']
]);


setupMessagesFileIfItDoesNotExists();


checkAndProcessNewMessages();


function setupMessagesFileIfItDoesNotExists() {
    if (!fs.existsSync('./messages.json')) {
        fs.copyFileSync('./messages-template.json', './messages.json');
    }
}


function checkAndProcessNewMessages() {

    const req = https.get(`${BASE_URL}?format=json&action=search&limit=${LIMIT_MESSAGES_SYNC}`, (res) => {

        if (res.statusCode !== 200) {
            logFailedDataFetch(res.statusMessage);
            return;
        }

        let body = '';

        res.on('data', d => body += d);
        res.on('end', () => {

            // Get the messages that are currently available
            const currentMessages = JSON.parse(body);

            // Load all the messages we already know
            const pastMessages = loadPastMessages();

            // Check for messages we haven't seen yet
            const newMessages = findNewMessages(currentMessages, pastMessages);

            // Append all new messages to messages file
            saveNewMessages(pastMessages, newMessages);

            // Save messages in archive directory
            if (ARCHIVE_MESSAGES) {
                archiveNewMessages(newMessages);
            }

            // Log new messages, in case there were any
            if (newMessages.length > 0) {
                logNewMessages(newMessages)
            }

            // Tweet some of the new messages
            if (DO_THE_TWEETS) {
                tweetNewestMessages(newMessages)
            }

        });

    });
    req.on('error', e => logFailedDataFetch(e.message));
    req.end();

}


function loadPastMessages() {
    return JSON.parse(fs.readFileSync('./messages.json', 'utf-8'));
}


function findNewMessages(currentMessages, pastMessages) {
    return currentMessages.filter(currentMessage => !pastMessages.some(pastMessage => pastMessage.id === currentMessage.id));
}


function saveNewMessages(pastMessages, newMessages) {
    const allMessages = pastMessages.concat(...newMessages);
    const strMessages = JSON.stringify(allMessages, null, 2);
    fs.writeFileSync('./messages.json', strMessages);
}


function fetchMessageDetails(message) {

    return new Promise((resolve, reject) => {

        const req = https.get(`${BASE_URL}?format=json&action=detail&id=${message.id}`, res => {

            if (res.statusCode !== 200) {
                return reject(res.statusMessage);
            }

            let body = '';

            res.on('data', d => body += d);
            res.on('end', () => {

                // Get the messages that are currently available
                const messageDetails = JSON.parse(body);
                if (messageDetails && messageDetails.length > 0) {
                    return resolve(messageDetails[0]);
                }

                return reject(`No details for message "${message.id}"`);

            });

        });
        req.on('error', e => reject(e.message));
        req.end();

    });

}


function fetchImage(messageDetails) {

    return new Promise((resolve, reject) => {

        const imageId = messageDetails.messageImage.id;
        const req = https.get(`https://include-st.zfinder.de/IWImageLoader?mediaId=${imageId}`, (res) => {

            if (res.statusCode !== 200) {
                return reject(res.statusMessage);
            }

            const imageData = [];

            res.on('data', d => imageData.push(d));
            res.on('end', () => resolve(Buffer.concat(imageData)));

        });
        req.on('error', () => reject(e.message));
        req.end();

    });

}


function saveImage(messageDetails, imageDataBuffer) {
    const mimeType = messageDetails.messageImage.mimeType;
    const fileExtension = mimeType === 'image/jpeg' ? '.jpeg' : (mimeType === 'image/png' ? '.png' : '');
    const filename = `./archive/images/${messageDetails.id}-${messageDetails.messageImage.id}${fileExtension}`;
    fs.writeFileSync(filename, imageDataBuffer);
}


async function uploadImage(imageDataBuffer) {

    return new Promise((resolve, reject) => {

        const base64 = imageDataBuffer.toString('base64');
        const uploadParams = { media_data: base64 };
        twitterClient.media
            .mediaUpload(uploadParams)
            .then(uploadResult => resolve(uploadResult.media_id_string))
            .catch(reject);

    });

}


function archiveNewMessages(messages) {

    const now = new Date();
    const year = now.getUTCFullYear();
    const month = `${now.getUTCMonth() + 1}`.padStart(2, '0');
    const day = `${now.getUTCDate()}`.padStart(2, '0');
    const hour = `${now.getUTCHours()}`.padStart(2, '0');
    const minutes = `${now.getUTCMinutes()}`.padStart(2, '0');
    const seconds = `${now.getUTCSeconds()}`.padStart(2, '0');

    const filename = `${year}-${month}-${day}T${hour}-${minutes}-${seconds}Z-messages.json`;
    const strMessages = JSON.stringify(messages, null, 2);
    fs.writeFileSync(`./archive/${filename}`, strMessages);

}


function tweetNewestMessages(messages) {

    const tweetQueue = messages
        .sort((a, b) => a.createdDate > b.createdDate ? -1 : 0)
        .slice(0, MAX_TWEETS_PER_RUN)
        .reverse();

    tweetQueue.forEach(delay(processMessage, TWEET_DELAY_SECONDS * 1000))

}


function delay(fn, delay) {
    return (name, i) => setTimeout(() => fn(name), i * delay);
}


async function processMessage(message) {

    const localeOptions = { day: '2-digit', month: '2-digit', year: 'numeric' };
    const date = new Date(message.createdDate).toLocaleDateString('de-DE', localeOptions);
    const url = `${BASE_URL}#meldungDetail?id=${message.id}`;
    let status = `Meldung vom ${date}:
    
${message.subject}
${url}`;

    const coordinateSystem = message.messagePosition?.geoCoding?.coordinateSystem;
    const display_coordinates = coordinateSystem === 'EPSG:25832' || coordinateSystem === 'EPSG:4326';
    let lat = null;
    let long = null;
    if (display_coordinates) {

        const coord = [message.messagePosition.geoCoding.longitude, message.messagePosition.geoCoding.latitude];
        if (coordinateSystem === 'EPSG:25832') {
            const destinationCoord = proj4('EPSG:25832', 'EPSG:4326', coord);
            lat = destinationCoord[1];
            long = destinationCoord[0];
        } else {
            lat = message.messagePosition.geoCoding.latitude;
            long = message.messagePosition.geoCoding.longitude;
        }

    }

    let messageDetails = null;
    try {
        messageDetails = await fetchMessageDetails(message);
    } catch (e) {
        return logFailedDetailsFetch(e);
    }

    if (messageDetails.messageImage) {

        let imageData = null;
        try {
            imageData = await fetchImage(messageDetails);
        } catch (e) {
            return logFailedImageFetch(e);
        }

        try {
            await saveImage(messageDetails, imageData);
        } catch (e) {
            return logFailedImageSave(e);
        }

        let mediaId = null;
        if (TWEET_WITH_IMAGE) {

            try {
                mediaId = await uploadImage(imageData);
            } catch (e) {
                return logFailedTweet(e);
            }

            status += `
Bild: LH Magdeburg`;

        }

        try {
            await sendTweet(status, display_coordinates, lat, long, mediaId);
        } catch(e) {
            return logFailedTweet(e);
        }

    } else {
        sendTweet(status, display_coordinates, lat, long, null)
        .then(console.info)
        .catch(logFailedTweet);
    }

}


function sendTweet(status, display_coordinates, lat, long, mediaId) {
    const parameters = display_coordinates
        ? { status, display_coordinates, lat, long, media_ids: mediaId }
        : { status, media_ids: mediaId };
    return twitterClient.tweets.statusesUpdate(parameters);
}


function logFailedDataFetch(errorMessage) {
    const text = `Fetching data failed: ${errorMessage}`;
    if (LOG_TO_SLACK_CHANNEL) {
        sendToSlackChannel(text);
    } else {
        console.error(text);
    }
}


function logFailedDetailsFetch(errorMessage) {
    const text = `Fetching details failed: ${errorMessage}`;
    if (LOG_TO_SLACK_CHANNEL) {
        sendToSlackChannel(text);
    } else {
        console.error(text);
    }
}


function logFailedImageFetch(errorMessage) {
    const text = `Fetching image failed: ${errorMessage}`;
    if (LOG_TO_SLACK_CHANNEL) {
        sendToSlackChannel(text);
    } else {
        console.error(text);
    }
}


function logFailedImageSave(errorMessage) {
    const text = `Saving image failed: ${errorMessage}`;
    if (LOG_TO_SLACK_CHANNEL) {
        sendToSlackChannel(text);
    } else {
        console.error(text);
    }
}


function logNewMessages(messages) {
    const text = `Found new messages: ${messages.length}`;
    if (LOG_TO_SLACK_CHANNEL) {
        sendToSlackChannel(text);
    } else {
        console.info(text);
    }
}


function logFailedTweet(error) {
    const text = `Sending tweet failed: ${JSON.stringify(error.data)}`;
    if (LOG_TO_SLACK_CHANNEL) {
        sendToSlackChannel(text);
    } else {
        console.error(text);
    }
}


function sendToSlackChannel(text) {

    const strData = JSON.stringify({ text });
    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': strData.length
        }
    };
    const req = https.request(
        SLACK_WEBHOOK_URL,
        options,
        res => res.on('data', d => process.stdout.write(d))
    );

    req.on('error', error => console.error(error));
    req.write(strData);
    req.end();

}
