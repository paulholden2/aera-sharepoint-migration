const program = require('commander');
const Sequelize = require('sequelize');
const SharePoint = require('@paulholden/sharepoint');
const dotenv = require('dotenv');
const orm = require('./lib/orm.js');
const Application = require('./lib/application.js');

// Load .env configuration
dotenv.config();

// Process commandline arguments
program.option('-d, --debug', 'extra debugging output');
program.option('-O, --orm-only', 'only sync ORM with database')
program.option('-R, --retry-only', 'only retry failed migrations');
program.parse(process.argv);

// Sequelize connection
let sequelize = new Sequelize('Aera Energy', process.env.MSSQL_USERNAME, process.env.MSSQL_PASSWORD, {
  host: 'STRIA-SQL1',
  dialect: 'mssql',
  logging: !!program.debug ? console.log : false
});

// SharePoint site
let sharepoint = new SharePoint(process.env.SHAREPOINT_URL);

// Load ORM models
let models = orm(sequelize);

sequelize.authenticate().then(res => {
  // Leave force: false unless you want to summon hellfire
  return sequelize.sync({ force: false });
}).then(() => {
  return sharepoint.authenticate(process.env.SHAREPOINT_USERNAME, process.env.SHAREPOINT_PASSWORD);
}).then(() => {
  return sharepoint.getWebEndpoint()
}).then(async () => {
  if (program.ormOnly) {
    return Promise.resolve();
  }
  let options = {
    // Where the program will check for files to migrate
    outputDirectory: process.env.DELIVERY_OUTPUT_DIR
  };
  let app = new Application(sequelize, sharepoint, program, options);
  return app.run();
}).catch(err => {
  console.error(err);
});
