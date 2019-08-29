const Sequelize = require('sequelize');

module.exports = sequelize => {
  const Migration = sequelize.define('TestWellLogMigrations', {
    'File Path': {
      type: Sequelize.STRING(1000),
      allowNull: false,
      unique: 'FilePathIndex'
    },
    'Timestamp': {
      type: Sequelize.DATE,
      allowNull: false
    },
    'Uploaded Bytes': {
      type: Sequelize.BIGINT,
      allowNull: false,
      defaultValue: 0
    },
    'File Size In Bytes': {
      type: Sequelize.BIGINT,
      allowNull: false
    },
    'Upload HTTP Status': {
      type: Sequelize.STRING
    },
    'Upload Status Description': {
      type: Sequelize.STRING(1000)
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
