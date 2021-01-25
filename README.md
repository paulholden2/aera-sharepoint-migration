# Aera SharePoint migration tool

A command-line tool to deliver files from local storage to Aera's SharePoint site.

## Getting started

This tool is usable from source after cloning (run it as a Node.js script) or you can build it into a Windows executable file. The examples below show usage as a script. Replace `node index.js` with your executable file name if you go that route.

You can see a list of all available options with the `-h` switch:

```
$ node index.js -h
```

### Configuration

A configuration file is required for this tool to run. Configuration files must be in the JSON or INI format, and are loaded from:

 1) Any file passed via --config argument
 2) Any .aerasprc file found in local or parent directories
    * Note: not available for packaged binaries
 3) $HOME/.aerasprc
 4) $HOME/.aerasp/config
 5) $HOME/.config/aerasp
 6) $HOME/.config/aerasp/config
 7) /etc/aerasprc
 8) /etc/aerasp/config

 :warning: &nbsp; **Important: Data is merged down; earlier configs override those that follow.** &nbsp;  :warning:

#### Example configuration (JSON):

```json
{
  "mssql": {
    "username": "sa",
    "password": "verysecure"
  },
  "sharepoint": {
    "url": "https://aeraenergyllc.sharepoint.com/sites/centralfilesdemo",
    "username": "jdoe",
    "password": "excelsior"
  },
  "deliveryOutputDir": "\\\\storage1\\where\\the\\files\\are",
  "deliveryTriggerSuffix": "_Ready To Deliver",
  "migrationTable": "aerasp_file_log"
}
```

#### About configuration settings

 - mssql.*: Microsoft SQL Server credentials.
 - sharepoint.*: SharePoint site connection info and credentials.
 - deliveryOutputDir: Where to look for delivery directories.
 - deliveryTriggerSuffix: If delivery directories end with this string, the
                          upload agent will process them.
 - migrationTable: Name of the database table to log file upload details to.
 

## Dealing with common issues

Since its launch, there have been some issues that reoccur with some frequency. The tool itself hasn't been developed or updated to handle these issues, and usually results in the delivery folder needing manual fixes so that the files are uploaded. Some examples of common issues are:

* Filenames with invalid characters such: & ' ` #
* Invalid column names in the load file (ordering doesn't matter, just naming)
* Varying well data (see below)
* Filenames in load file don't match the actual corresponding file's name

### Invalid characters in filename

These characters interfere with the syntax of requests sent to SharePoint. It can be tricky to identify this because sometimes the response will be `4XX` (client error) and sometimes it will be `5XX` (server error). Just get in the habit of first checking for invalid characters if a delivery fails after multiple attempts.

### Varying well data

This issue prevents any files from being delivered to prevent inconsistencies in the data applied to document sets & documents in SharePoint. This is caused by a load file that has two values for an API when it should really be one, e.g. two Township values for a single API. Fixing this requires checking all of the data and ensuring all APIs in the load file have the same value for everything except the following fields, which are specific to the documents:

1. Filename
2. Document Title
3. Date

### Invalid filenames/missing files

Sometimes it can be clear which file corresponds to a row in a load file, but in most cases it is advisable to consult Stephen or someone from production who can verify.
