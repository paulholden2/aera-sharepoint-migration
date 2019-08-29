const fs = require('fs');
const path = require('path');

class Application {
  constructor(sequelize, sharepoint, program, options) {
    this.sequelize = sequelize;
    this.sharepoint = sharepoint;
    this.program = program;
    this.options = options;
  }

  run() {
    this.log('Executing Aera SharePoint upload agent');
    this.log('======================================');
    this.log(`Output directory: ${this.options.outputDirectory}`);
    const baseDir = this.options.outputDirectory;
    let action = {};
    let promise = new Promise((resolve, reject) => {
      action.resolve = resolve;
      action.reject = reject;
    });
    fs.readdir(baseDir, (err, files) => {
      if (err) {
        return action.reject(err);
      }
      const dirs = files.map(file => path.join(baseDir, file)).filter(file => {
        const stat = fs.statSync(file);
        return stat.isDirectory();
      });
      let promises = dirs.map(dir => this.processDeliveryDir(dir));
      Promise.all(promises).then(() => {
        action.resolve(0);
      }).catch(action.reject);
    });
    return promise;
  }

  processDeliveryDir(path) {
    let action = {}
    let promise = new Promise((resolve, reject) => {
      action.resolve = resolve;
      action.reject = reject;
    });
    fs.readdir(path, (err, files) => {
      if (err) {
        return action.reject(err);
      }
      this.log(files);
      action.resolve();
    });
    return promise;
  }

  log(...args) {
    if (this.program.debug) {
      console.log(...args)
    }
  }
}

module.exports = Application;
