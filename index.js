const program = require('commander');
require('tedious'); // Require for pkg to pick up dependency
const Sequelize = require('sequelize');
const SharePoint = require('@paulholden/sharepoint');
const loadOrmModels = require('./lib/orm.js');
const Application = require('./lib/application.js');
const rc = require('rc');

const APP = 'aerasp';
const conf = rc(APP);

if (!conf.configs) {
  console.error('No config files were found. Configuration is loaded from:');
  console.error('');
  console.error(' 1) Any file passed via --config argument');
  console.error(` 2) Any .${APP}rc file found in local or parent directories`)
  console.error(` 3) $HOME/.${APP}rc`);
  console.error(` 4) $HOME/.${APP}/config`);
  console.error(` 5) $HOME/.config/${APP}`);
  console.error(` 6) $HOME/.config/${APP}/config`);
  console.error(` 7) /etc/${APP}rc`);
  console.error(` 8) /etc/${APP}/config`);
  console.error('');
  console.error('Configurations are loaded in JSON or INI format.');
  console.error('Data is merged down; earlier configs override those that follow.');
  return;
}

// Process commandline arguments
program.option('-d, --debug', 'extra debugging output');
program.option('-O, --orm-only', 'only sync ORM with database')
program.option('-R, --retry-only', 'only retry failed migrations');
program.parse(process.argv);

// Sequelize connection
let sequelize = new Sequelize('Aera Energy', conf.mssql.username, conf.mssql.password, {
  host: 'STRIA-SQL1',
  dialect: 'mssql',
  logging: !!program.debug ? console.log : false
});
// SharePoint site
let sharepoint = new SharePoint(conf.sharepoint.url);
let options = {
  // Where the program will check for files to migrate
  outputDirectory: conf.deliveryOutputDir,
  // The SQL table that will contain migrated file details
  migrationTable: conf.migrationTable
};
// Load ORM models
let models = loadOrmModels(sequelize, options);

sequelize.authenticate().then(res => {
  // Leave force: false unless you want to summon hellfire
  return sequelize.sync({ force: false });
}).then(() => {
  return sharepoint.authenticate(conf.sharepoint.username, conf.sharepoint.password);
}).then(() => {
  return sharepoint.getWebEndpoint()
}).then(async () => {
  if (program.ormOnly) {
    return Promise.resolve();
  }
  let app = new Application(sequelize, sharepoint, program, options);
  return app.run();
}).catch(err => {
  console.error(err);
});
