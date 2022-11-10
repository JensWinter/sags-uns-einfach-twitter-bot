'use strict';

const axios = require('axios');
const fs = require('fs');
const winston = require('winston');
const dateFns = require('date-fns');
const { MongoClient } = require('mongodb');
const { getMessageLocation } = require('./get-location');
const AWS = require('aws-sdk');

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
const messagesDir = `${tenantDir}/messages`;
const allMessagesFilename = `${messagesDir}/all-messages.json`;
const imagesDir = `${tenantDir}/images`;
const queueTwitterNewMessagesDir = `${tenantDir}/queues/twitter/new_messages`;
const queueMastodonNewMessagesDir = `${tenantDir}/queues/mastodon/new_messages`;
const queueTwitterResponseUpdatesDir = `${tenantDir}/queues/twitter/response_updates`;
const queueMastodonResponseUpdatesDir = `${tenantDir}/queues/mastodon/response_updates`;
const archiveDir = './archive';
const tenantArchiveDir = `${archiveDir}/${tenantKey}`;
const archiveImagesDir = `${tenantArchiveDir}/images`;
const archiveMessagesDir = `${tenantArchiveDir}/messages`;

const logger = initLogger();

const LIMIT_MESSAGES_FETCH = tenant.config.limitMessagesFetch;
const PROCESS_DELAY_SECONDS = tenant.config.processDelaySeconds;
const MAX_QUEUE_SIZE = tenant.config.maxQueueSize;
const LOG_TO_SLACK_CHANNEL = tenant.config.logToSlackChannel;
const ARCHIVE_OLD_MESSAGES = tenant.config.archiveOldMessages;

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_NAME = process.env.DATABASE_NAME;


const mongoClient = new MongoClient(DATABASE_URL);
const db = mongoClient.db(DATABASE_NAME);
const messagesCollection = db.collection('messages');

const s3 = new AWS.S3({
    accessKeyId: process.env.AWS_S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_S3_SECRET_ACCESS_KEY,
});


(async () => {

    logger.info('Run started.');

    try {
        prepareTenantDirectories();
        await mongoClient.connect();
        await fetchAndProcessMessages();
    } catch (e) {
        logError(e);
    } finally {
        await mongoClient.close();
    }

    logger.info('Run finished.');

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
            new winston.transports.File({ filename: `${tenantDir}/output-fetch-messages.log` }),
            new winston.transports.Console({ format: winston.format.simple() })
        ]
    });

}


function prepareTenantDirectories() {
    if (!fs.existsSync(messagesDir)) {
        logger.info('Creating messages directory.')
        fs.mkdirSync(messagesDir, { recursive: true });
    }
    if (!fs.existsSync(imagesDir)) {
        logger.info('Creating images directory.')
        fs.mkdirSync(imagesDir, { recursive: true });
    }
    if (!fs.existsSync(allMessagesFilename)) {
        logger.info('Creating messages file.')
        fs.writeFileSync(allMessagesFilename, JSON.stringify([], null, 2));
    }
    if (!fs.existsSync(queueTwitterNewMessagesDir)) {
        logger.info('Creating new messages queue directory.')
        fs.mkdirSync(queueTwitterNewMessagesDir, { recursive: true });
    }
    if (!fs.existsSync(queueMastodonNewMessagesDir)) {
        logger.info('Creating new messages Twitter queue directory.')
        fs.mkdirSync(queueMastodonNewMessagesDir, { recursive: true });
    }
    if (!fs.existsSync(queueTwitterResponseUpdatesDir)) {
        logger.info('Creating response updates Twitter queue directory.')
        fs.mkdirSync(queueTwitterResponseUpdatesDir, { recursive: true });
    }
    if (!fs.existsSync(queueMastodonResponseUpdatesDir)) {
        logger.info('Creating response updates Mastodon queue directory.')
        fs.mkdirSync(queueMastodonResponseUpdatesDir, { recursive: true });
    }
    if (ARCHIVE_OLD_MESSAGES && !fs.existsSync(archiveMessagesDir)) {
        fs.mkdirSync(archiveMessagesDir, { recursive: true });
    }
    if (ARCHIVE_OLD_MESSAGES && !fs.existsSync(archiveImagesDir)) {
        fs.mkdirSync(archiveImagesDir, { recursive: true });
    }
}


async function fetchAndProcessMessages() {

    // Get the messages that are currently available
    const currentMessages = await fetchCurrentMessages();

    // Load all the messages we already know
    const pastMessages = loadPastMessages();

    // Check for messages we haven't seen yet
    const newMessages = findNewMessages(currentMessages, pastMessages);

    // Check if there are any new messages
    await processNewMessages(pastMessages, newMessages);

    // Check if there are any updates to already known messages
    await processMessageUpdates(currentMessages)

    if (ARCHIVE_OLD_MESSAGES) {
        await archiveOldMessages(pastMessages, currentMessages)
    }

}


async function fetchCurrentMessages() {
    const { data } = await axios.get(`${tenantBaseUrl}?format=json&action=search&limit=${LIMIT_MESSAGES_FETCH}`);
    return data;
}


function loadPastMessages() {
    return JSON.parse(fs.readFileSync(allMessagesFilename, 'utf-8'));
}


function findNewMessages(currentMessages, pastMessages) {
    return currentMessages.filter(currentMessage => !pastMessages.some(pastMessage => pastMessage.id === currentMessage.id));
}


async function processNewMessages(pastMessages, newMessages) {

    if (newMessages.length === 0) {
        return logger.info('No new messages to process.');
    }

    logNewMessages(newMessages)
    recordNewMessages(pastMessages, newMessages);

    await processNewMessagesDelayed(newMessages);

    logger.info('Processing new messages finished.');

}


async function processMessageUpdates(currentMessages) {
    logger.info('Checking for message updates');
    await processMessageUpdatesDelayed(currentMessages);
    logger.info('Processing message updates finished.');
}


function recordNewMessages(pastMessages, newMessages) {
    const allMessages = pastMessages.concat(...newMessages);
    const strMessages = JSON.stringify(allMessages, null, 2);
    fs.writeFileSync(allMessagesFilename, strMessages);
}


async function processNewMessagesDelayed(messages) {

    return new Promise(resolve => {
        messages
            .sort((a, b) => a.createdDate > b.createdDate ? -1 : 0)
            .reverse()
            .forEach(delayProcessMessage(processNewMessage));
        delayProcessMessage(resolve)(null, messages.length);
    });

}


async function processMessageUpdatesDelayed(messages) {

    return new Promise(resolve => {

        let index = 0;
        messages
            .sort((a, b) => a.lastUpdated > b.lastUpdated ? -1 : 0)
            .reverse()
            .forEach(message => {

                const filepath = `${messagesDir}/message-${message.id}.json`;
                if (fs.existsSync(filepath)) {
                    const oldMessage = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
                    if (message.lastUpdated > oldMessage.lastUpdated) {
                        delayProcessMessage(processMessageUpdate)(oldMessage, index);
                        index++;
                    }
                }

            });

        delayProcessMessage(resolve)(null, index);

    });

}


function delayProcessMessage(fn) {
    return (message, i) => setTimeout(() => fn(message), i * PROCESS_DELAY_SECONDS * 1000);
}


async function processNewMessage(message) {

    try {

        const messageDetails = await fetchMessageDetails(message);

        saveMessageDetailsToFile(messageDetails);
        await saveMessageDetailsToDatabase(messageDetails);

        if (messageDetails.messageImage) {
            const imageData = await fetchImage(messageDetails);
            await saveImageToFile(messageDetails, imageData);
            await saveImageToS3(messageDetails, imageData);
        }

        if (MAX_QUEUE_SIZE > 0) {
            enqueueNewMessage(messageDetails);
            if (messageDetails.responses.length > 0) {
                enqueueResponseUpdate(messageDetails);
            }
        }

    } catch (e) {
        return logFailedProcessNewMessage(e);
    }

}


async function processMessageUpdate(oldMessage) {

    try {

        const messageDetails = await fetchMessageDetails(oldMessage);

        saveMessageDetailsToFile(messageDetails);
        await saveMessageDetailsToDatabase(messageDetails);

        if (oldMessage.responses.length < messageDetails.responses.length) {
            const newResponsesCount = messageDetails.responses.length - oldMessage.responses.length;
            logger.info(`${newResponsesCount} new response(s) in message "${messageDetails.id}" `);
            if (MAX_QUEUE_SIZE > 0) {
                enqueueResponseUpdate(messageDetails);
            }
        }

    } catch (e) {
        return logFailedProcessMessageUpdate(e);
    }

}


async function fetchMessageDetails(message) {

    logger.info(`Fetching details for message "${message.id}"`);

    const { data } = await axios.get(`${tenantBaseUrl}?format=json&action=detail&id=${message.id}`);

    // Get the messages that are currently available
    const messageDetails = data;
    if (messageDetails && messageDetails.length > 0) {
        logger.info(`Received details for message "${message.id}"`);
        return messageDetails[0];
    }

    return Promise.reject(`No details for message "${message.id}"`)

}


function saveMessageDetailsToFile(message) {
    logger.info(`Saving details for message "${message.id}" to file`);
    const filename = `message-${message.id}.json`;
    const strMessage = JSON.stringify(message, null, 2);
    fs.writeFileSync(`${messagesDir}/${filename}`, strMessage);
}


async function saveMessageDetailsToDatabase(message) {
    logger.info(`Saving details for message "${message.id}" to database`);
    const location = getMessageLocation(message);
    const doc = { ...message, tenantKey, location };
    await messagesCollection.replaceOne({ id: message.id }, doc, { upsert: true })
}


async function fetchImage(messageDetails) {

    logger.info(`Fetching image of message "${messageDetails.id}"`);

    const { data } = await axios.get(
        `${baseUrl}/IWImageLoader?mediaId=${messageDetails.messageImage.id}`,
        { responseType: 'arraybuffer' }
    );
    return data;

}


function saveImageToFile(messageDetails, imageDataBuffer) {
    logger.info(`Saving image of message "${messageDetails.id}" to file`);
    const mimeType = messageDetails.messageImage.mimeType;
    const fileExtension = mimeType === 'image/jpeg' ? '.jpeg' : (mimeType === 'image/png' ? '.png' : '');
    const filename = `${imagesDir}/${messageDetails.id}-${messageDetails.messageImage.id}${fileExtension}`;
    fs.writeFileSync(filename, imageDataBuffer);
}


async function saveImageToS3(messageDetails, imageDataBuffer) {
    logger.info(`Saving image of message "${messageDetails.id}" to S3`);
    const mimeType = messageDetails.messageImage.mimeType;
    const fileExtension = mimeType === 'image/jpeg' ? '.jpeg' : (mimeType === 'image/png' ? '.png' : '');
    const filename = `${messageDetails.id}-${messageDetails.messageImage.id}${fileExtension}`;
    return s3.upload({
        Bucket: process.env.AWS_S3_BUCKET_NAME,
        Key: `tenants/${tenantKey}/images/${filename}`,
        Body: imageDataBuffer,
    }).promise();
}


function enqueueNewMessage(messageDetails) {
    const currentTwitterQueueSize = fs.readdirSync(queueTwitterNewMessagesDir).length;
    if (currentTwitterQueueSize < MAX_QUEUE_SIZE) {
        logger.info(`Saving message "${messageDetails.id}" into new messages Twitter queue`);
        fs.writeFileSync(`${queueTwitterNewMessagesDir}/message-${messageDetails.id}.json`, JSON.stringify(messageDetails, null, 2));
    } else {
        logger.warn(`Didn't queue new message "${messageDetails.id}". Twitter queue is full!`);
    }

    const currentMastodonQueueSize = fs.readdirSync(queueMastodonNewMessagesDir).length;
    if (currentMastodonQueueSize < MAX_QUEUE_SIZE) {
        logger.info(`Saving message "${messageDetails.id}" into new messages Mastodon queue`);
        fs.writeFileSync(`${queueMastodonNewMessagesDir}/message-${messageDetails.id}.json`, JSON.stringify(messageDetails, null, 2));
    } else {
        logger.warn(`Didn't queue new message "${messageDetails.id}". Mastodon queue is full!`);
    }
}


function enqueueResponseUpdate(messageDetails) {
    const currentTwitterQueueSize = fs.readdirSync(queueTwitterResponseUpdatesDir).length;
    if (currentTwitterQueueSize < MAX_QUEUE_SIZE) {
        logger.info(`Saving response update for message "${messageDetails.id}" into response update Twitter queue`);
        fs.writeFileSync(`${queueTwitterResponseUpdatesDir}/message-${messageDetails.id}.json`, JSON.stringify(messageDetails, null, 2));
    } else {
        logger.warn(`Didn't queue response update for message "${messageDetails.id}". Twitter queue is full!`);
    }

    const currentMastodonQueueSize = fs.readdirSync(queueMastodonResponseUpdatesDir).length;
    if (currentMastodonQueueSize < MAX_QUEUE_SIZE) {
        logger.info(`Saving response update for message "${messageDetails.id}" into response update Mastodon queue`);
        fs.writeFileSync(`${queueMastodonResponseUpdatesDir}/message-${messageDetails.id}.json`, JSON.stringify(messageDetails, null, 2));
    } else {
        logger.warn(`Didn't queue response update for message "${messageDetails.id}". Mastodon queue is full!`);
    }
}


async function archiveOldMessages(pastMessages, currentMessages) {

    const thresholdDate = dateFns.endOfISOWeek(dateFns.subMonths(new Date(), 6));
    const allMessages = loadPastMessages();
    const messagesToArchive = allMessages.filter(m1 => {
        const messageNotInFetchResult = currentMessages.every(m2 => m2.id !== m1.id);
        const messageTooOld = dateFns.isBefore(m1.lastUpdated, thresholdDate)
        return messageNotInFetchResult || messageTooOld;
    });

    const allImageFiles = fs.readdirSync(imagesDir);
    messagesToArchive.forEach(message => {

        // Move image files
        const imageFiles = allImageFiles.filter(file => file.startsWith(`${message.id}-`));
        imageFiles.forEach(
            imageFile => fs.renameSync(`${imagesDir}/${imageFile}`, `${archiveImagesDir}/${imageFile}`)
        );

        // Move message file
        if (fs.existsSync(`${messagesDir}/message-${message.id}.json`)) {
            fs.renameSync(
                `${messagesDir}/message-${message.id}.json`,
                `${archiveMessagesDir}/message-${message.id}.json`
            );
        }

    });

    logger.info('Archiving old messages finished.');

}


function logFailedProcessNewMessage(errorMessage) {
    const text = `Processing new message failed: ${errorMessage}`;
    logger.error(text)
    if (LOG_TO_SLACK_CHANNEL) {
        sendToSlackChannel(text);
    }
}


function logFailedProcessMessageUpdate(errorMessage) {
    const text = `Processing message update failed: ${errorMessage}`;
    logger.error(text)
    if (LOG_TO_SLACK_CHANNEL) {
        sendToSlackChannel(text);
    }
}


function logError(error) {
    const text = `ERROR: ${error}`;
    logger.error(text);
    if (LOG_TO_SLACK_CHANNEL) {
        sendToSlackChannel(text);
    }
}


function logNewMessages(messages) {
    const text = `Found new messages: ${messages.length}`;
    logger.info(text);
    if (LOG_TO_SLACK_CHANNEL) {
        sendToSlackChannel(text);
    }
}


function sendToSlackChannel(message) {
    const text = `${tenantKey}: ${message}`;
    const strData = JSON.stringify({ text });
    axios
        .post(SLACK_WEBHOOK_URL, strData)
        .catch(e => logger.error(e));
}
