'use strict';

const fs = require('fs');
const dateFns = require('date-fns');
const winston = require('winston');

require('dotenv').config();


const tenant = initArgs();
if (!tenant) {
    console.error('Couldn\'t load tenant configuration.');
    process.exit(1);
}

const tenantKey = tenant.key;
const tenantsDir = './tenants';
const tenantDir = `${tenantsDir}/${tenantKey}`;
const messagesDir = `${tenantDir}/messages`;
const allMessagesFilename = `${messagesDir}/all-messages.json`;
const queueTwitterStatisticsUpdatesDir = `${tenantDir}/queues/twitter/statistics_updates`;
const queueMastodonStatisticsUpdatesDir = `${tenantDir}/queues/mastodon/statistics_updates`;

const logger = initLogger();

const MAX_QUEUE_SIZE = tenant.config.maxQueueSize;


prepareTenantDirectory();


createStatsTweet();


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
            new winston.transports.File({ filename: `${tenantDir}/output-create-stats.log` }),
            new winston.transports.Console({ format: winston.format.simple() })
        ]
    });

}


function prepareTenantDirectory() {
    if (!fs.existsSync(messagesDir)) {
        logger.info('Creating messages directory.')
        fs.mkdirSync(messagesDir, { recursive: true });
    }
    if (!fs.existsSync(allMessagesFilename)) {
        logger.info('Creating messages file.')
        fs.writeFileSync(allMessagesFilename, JSON.stringify([], null, 2));
    }
    if (!fs.existsSync(queueTwitterStatisticsUpdatesDir)) {
        logger.info('Creating weekly statistics Twitter queue directory.')
        fs.mkdirSync(queueTwitterStatisticsUpdatesDir, { recursive: true });
    }
    if (!fs.existsSync(queueMastodonStatisticsUpdatesDir)) {
        logger.info('Creating weekly statistics Mastodon queue directory.')
        fs.mkdirSync(queueMastodonStatisticsUpdatesDir, { recursive: true });
    }
}


function createStatsTweet() {

    const allMessagesText = fs.readFileSync(allMessagesFilename, 'utf-8');
    const allMessages = JSON.parse(allMessagesText);

    const today = new Date();
    const startOfThisWeek = dateFns.startOfISOWeek(today);
    const lowerBoundWeek = dateFns.subWeeks(startOfThisWeek, 10);
    const createdDates = allMessages
        .map(m => {
            const createdDate = dateFns.fromUnixTime(m.createdDate / 1000);
            return {
                createdDate,
                week: dateFns.getISOWeek(createdDate, { weekStartsOn: 1 }),
                year: dateFns.getISOWeekYear(createdDate)
            };
        })
        .filter(m => dateFns.isAfter(m.createdDate, lowerBoundWeek))
        .sort((a, b) => a.year === b.year ? b.week - a.week : b.year - a.year);

    const createdDatesGrouped = createdDates.reduce(
        (entryMap, e) => {
            const key = `${e.year}-${e.week.toString().padStart(2, '0')}`;
            return entryMap.set(key, [...entryMap.get(key) || [], e]);
        },
        new Map()
    );
    const chartLines = Array
        .from(createdDatesGrouped.values())
        .map(group => ({
            year: group[0].year,
            week: group[0].week,
            cnt: group.length
        }))
        .map(entry => {
            const fullBlocksCnt = Math.min(15, Math.round(entry.cnt / 10));
            const halfBlocksCnt = Math.max(0, 15 - fullBlocksCnt);
            const chartLine = '▓'.repeat(fullBlocksCnt) + ''.repeat(halfBlocksCnt);
            return 'KW ' + getWeekBlockStr(entry.week) + ' ' + chartLine + '  ' + entry.cnt;
        })
        .slice(0, 8);

    const tweetText = `Neue MD-Melder-Einträge

${chartLines.join('\n')}

#MDMelderStats`;

    enqueueStatisticsUpdate(tweetText, today);

}


function getWeekBlockStr(week) {
    const weekStr = week >= 10 ? `${week}` : `    ${week}`;
    return [...weekStr]
        .map(char => {
            switch (char) {
                case '0': return '０';
                case '1': return '１';
                case '2': return '２';
                case '3': return '３';
                case '4': return '４';
                case '5': return '５';
                case '6': return '６';
                case '7': return '７';
                case '8': return '８';
                case '9': return '９';
                default: return char;
            }
        })
        .join('');
}


function enqueueStatisticsUpdate(text, date) {
    const dateStr = dateFns.formatISO(date, { representation: 'date' });

    const currentTwitterQueueSize = fs.readdirSync(queueTwitterStatisticsUpdatesDir).length;
    if (currentTwitterQueueSize < MAX_QUEUE_SIZE) {
        logger.info(`Saving statistics for "${dateStr}" into Twitter queue`);
        fs.writeFileSync(`${queueTwitterStatisticsUpdatesDir}/stats-${dateStr}.txt`, text);
    } else {
        logger.warn(`Didn't queue statistics "${messageDetails.id}". Twitter queue is full!`);
    }

    const currentMastodonQueueSize = fs.readdirSync(queueMastodonStatisticsUpdatesDir).length;
    if (currentMastodonQueueSize < MAX_QUEUE_SIZE) {
        logger.info(`Saving statistics for "${dateStr}" into Mastodon queue`);
        fs.writeFileSync(`${queueMastodonStatisticsUpdatesDir}/stats-${dateStr}.txt`, text);
    } else {
        logger.warn(`Didn't queue statistics "${messageDetails.id}". Mastodon queue is full!`);
    }
}
