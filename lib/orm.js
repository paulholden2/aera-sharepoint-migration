const Sequelize = require('sequelize');

module.exports = (sequelize, options) => {
  const Migration = sequelize.define(options.migrationTable, {
    'File Path': {
      type: Sequelize.STRING(1000),
      allowNull: false,
      unique: 'FilePathIndex'
    },
    'Uploaded Bytes': {
      type: Sequelize.BIGINT,
      allowNull: false,
      defaultValue: 0
    },
    'File Size In Bytes': {
      type: Sequelize.BIGINT
    },
    'Upload Status Description': {
      type: Sequelize.STRING(1000)
    },
    'Successful': {
      type: Sequelize.STRING(1),
      allowNull: false
    }
  }, {
    timestamps: true,
    createdAt: 'Created At',
    updatedAt: 'Updated At'
  });

  return {
    Migration
  };
};
