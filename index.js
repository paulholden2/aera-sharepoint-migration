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
  console.error('');
  console.error('Example configuration (JSON):');
  console.error(`  {`);
  console.error(`      "mssql": {`);
  console.error(`        "username": "<DB username>",`);
  console.error(`        "password": "<DB password>"`);
  console.error(`      },`);
  console.error(`      "sharepoint": {`);
  console.error(`        "url": "https://aeraenergyllc.sharepoint.com/sites/centralfilesdemo",`);
  console.error(`        "username": "<SharePoint username>",`);
  console.error(`        "password": "<SharePoint password>"`);
  console.error(`      },`);
  console.error(`      "deliveryOutputDir": "\\\\storage1\\where\\the\\files\\are",`);
  console.error(`      "deliveryTriggerSuffix": "_Ready To Deliver"`);
  console.error(`      "migrationTable": "<DB table name>"`);
  console.error(`    }`);
  console.error('');
  console.error('About configuration settings')
  console.error(' - mssql.*: Microsoft SQL Server credentials.');
  console.error(' - sharepoint.*: SharePoint site connection info and credentials.');
  console.error(' - deliveryOutputDir: Where to look for delivery directories.');
  console.error(' - deliveryTriggerSuffix: If delivery directories end with this string, the');
  console.error('                          upload agent will process them.');
  console.error(' - migrationTable: Name of the database table to log file upload details to.');
  return;
}

// Process commandline arguments
program.option('-d, --debug', 'extra debugging output');
program.option('-O, --orm-only', 'only sync ORM with database');
program.option('-R, --retry-failed', 'retry failed migrations');
program.option('-s, --stub-files', 'upload stub files instead of actual files (for testing/debugging)');
program.option('-f, --force-uploads', 'upload documents even if they already exist');
program.option('-w, --warn-missing', 'warn about files in load data that are missing');
program.option('-p, --parallelize <count>', 'how many parallel tasks to run');
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
  migrationTable: conf.migrationTable,
  // What suffix to look for in directories to trigger processing
  deliveryTriggerSuffix: conf.deliveryTriggerSuffix,
  // Should we log warnings for files missing from delivery folders but
  // present in load files
  warnMissing: program.warnMissing,
  forceUploads: program.forceUploads,
  // Should we use stub files instead of actuals (for debugging/testing)
  stubFiles: program.stubFiles,
  // Should failed migrations be retried?
  retryFailed: program.retryFailed,
  parallelize: program.parallelize
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
  let app = new Application(sequelize, models, sharepoint, program, options);
  return app.run();
}).catch(err => {
  console.error(`ERROR: ${err}`);
});
