
const fs = require('fs');

const tenantDirs = fs.readdirSync('tenants').map(dir => `tenants/${dir}`);
tenantDirs.forEach(tenantDir => {

    console.log(tenantDir);

    if (fs.existsSync(`${tenantDir}/output.log`)) {
        fs.unlinkSync(`${tenantDir}/output.log`);
    }

    const messagesDir = `${tenantDir}/messages`;
    if (fs.existsSync(messagesDir)) {
        const messagesFilesToRemove = fs.readdirSync(messagesDir).filter(file => file.endsWith('-messages.json') && file !== 'all-messages.json');
        messagesFilesToRemove.forEach(file => fs.unlinkSync(`${messagesDir}/${file}`));

        const messagesFilesToRename = fs.readdirSync(messagesDir).filter(file => file.startsWith('2021-') || file.startsWith('2022-'));
        messagesFilesToRename.forEach(file => fs.renameSync(`${messagesDir}/${file}`, `${messagesDir}/${file.slice(21)}`));
    }

});
