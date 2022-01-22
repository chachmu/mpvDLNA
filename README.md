# mpvDLNA
A plugin to allow mpv to browse and watch content hosted on DLNA servers. Follow the Installation Instructions [here](https://github.com/chachmu/mpvDLNA#installation-instructions)

## Usage
mpvDLNA has two main methods of interacting with DLNA servers. 

### Menu
Toggling the Menu will automatically scan for DLNA servers on the network if it does not have default servers defined in the config file. Once it has finished scanning it will display a list of servers. The arrow keys can be used to navigate the menu and selecting an entry in the list with the enter key (or right arrow key) will access it. Hitting the left arrow key will move back a folder. Attempting to access an empty folder will not enter the folder, instead it will turn the folder's name red. Accessing a media file will start playback while also adding playlist entries for the previous and next episodes so you can skip forwards and backwards without issues.

### Text/Command
Command mode opens a psuedo command prompt that allows for a variety of commands.

Both Command and Text mode support a fairly robust case insensitive autocompletion feature for commands (and certain types of arguments) that can also match the input to any part of the result although it sorts its recommendations by how close to the front of the string it found the input. For example, typing `re` might cause the autocompletion to first recommend "B***re***aking Bad" but tabbing through the suggestions you could find "The Wi***re***" (examples taken from the IMDb Most Popular TV Shows page).

File Input is essentially an argument that comes at the end of the command that is required to match an entry on the DLNA server through autocompletion or the command won't execute (Since the command has to be executed on an existing entry). Normal arguments will display a hint under the command input specifying what type of argument is expected. Calling `cd` on `..` will move back a folder.

| Command |  Argument   | File Input (Y/N) |                  Explanation                  |
| :-----: | :---------: | :-------------:  | --------------------------------------------- |
|   scan  |     N/A     |         N        |             Scan for DLNA servers             |
|   text  |     N/A     |         N        |              Switch to Text Mode              |
|    cd   |     N/A     |         Y        |        Access an item (or begin playback)     |
|   info  |     N/A     |         Y        |          Query the server for metadata        |
|    ep   |  Episode #  |         Y        | Find an episode based on episode # ([see more](https://github.com/chachmu/mpvDLNA#more-on-ep)) |
|   pep   |  Episode #  |         Y        |     Call ep and begin playback on the file    |
|   wake  | MAC Address |         N        |            Send a wake on lan packet          |


Text Mode is similar to Command Mode except it is only for navigating the DLNA server. Essentially it is always running the `cd` command. This makes it ideal for quickly browsing through the DLNA server and starting playback on a specified file.

## Installation Instructions
This script requires an installation of [mpv.io](https://mpv.io) that was built to support javascript and lua. 

1. Download the mpvDLNA folder either by cloning the repository or by downloading a zip of the [latest release](https://github.com/chachmu/mpvDLNA/releases)  
     (**make sure the folder is named `mpvDLNA`**, GitHub releases tend to add a version number to the end of the folder name which can cause problems)

2. Put the mpvDLNA folder in the `/scripts` folder for mpv (`~/.config/mpv/scripts/` for Linux or macOS or `C:/Users/Username/AppData/Roaming/mpv/scripts/` for Windows).

3.  Bind hotkeys (You can set your own but I personally like these keys) by adding these lines to `input.conf` (`~/.config/mpv/input.conf` for Linux or macOS or `C:/Users/Username/AppData/Roaming/mpv/input.conf` for Windows)
    * Toggle the Menu: `ctrl+b script-binding toggle_mpvDLNA`
    * Toggle Text Input:    `; script-binding text_mpvDLNA`
    * Toggle Command Input: `: script-binding command_mpvDLNA`

4. Install [uPnPclient](https://github.com/flyte/upnpclient) by running `pip install upnpclient`.
5. If you intend to use the wake on lan feature you will also need to install [pywakeonlan](https://github.com/remcohaszing/pywakeonlan) by running `pip install wakeonlan`


## main.js
This file contains the majority of the code including the gui. It handles storing and managing all of the information but due to limitations with the version of javascript supported by MPV ([MuJS](https://mujs.com)) it passes all DLNA communication through the mpvDLNA.py file. When starting playback of a file the DLNA url of the file is added to the internal MPV playlist and an event is triggered each time a file is loaded that adds the previous and next files to the playlist so you can skip forwards and backwards without issues.

More documentation on the specifics of how main.js works will be added at a later date.

## mpvDLNA.py
This python script supports a few simple operations to detect and browse DLNA servers. It is basically a simple wrapper of [flyte](https://github.com/flyte)'s [uPnPclient](https://github.com/flyte/upnpclient) library. This script also supports sending wake on lan packets using the [pywakeonlan](https://github.com/remcohaszing/pywakeonlan) module.

Supported Commands:
| Command     | Explanation                                                                                     |
| ----------- | ----------------------------------------------------------------------------------------------- |
|-l, --list   | Takes a timeout in seconds and outputs a list of DLNA Media Servers detected on the network     |
|-b, --browse | Takes a DLNA server url and the id of a DLNA element and outputs that element's direct children |
|-i, --info   | Takes a DLNA server url and the id of a DLNA element and outputs that element's metadata        |
|-w, --wake   | Takes a MAC address and attempts to send a wake on lan packet to it                             |

## Config File Example
The config file must be named mpvDLNA.conf and be placed in a folder called `/script-settings` in the same directory as the `/script` folder (_NOT INSIDE_).

```
# List of server names to automatically add without having to run scan
server_names={Name1}+{Name2}
# List of the server addresses, must correspond with server_names
server_addrs={Address1}+{Address2}

# List of mac addresses to autocomplete for wake on lan
mac_addresses={MAC_ID1}+{MAC_ID2}

# List of mac addresses to send a wake on lan packet to on startup
startup_mac_addresses={MAC_ID1}+{MAC_ID2}

# Font size of menu elements
font_size=35

# Font size of metadata description from the `info` command
description_font_size=10

# Command to use when calling python
python_version=python3

# Length of time to spend searching for DLNA servers (Try increasing this if you are having trouble finding your server, default is 1 second)
timeout = 20

# Number of nodes to fetch when making a request to the DLNA server (default is 2000)
count=5000
```

## More on `ep`
Given an absolute episode number (The episodes total position in the series instead of just its place in a season) and a series `ep` will try to scan through the show's various seasons to find the episode that matches.

This can be rather slow the first time it is called after opening MPV on longer series as mpvDLNA will have to fetch the information about every season preceding the one containing the correct episode and then every episode in that season preceding the episode itself. Successive calls for that series (up to the episode number loaded previously) should be very fast as mpvDLNA will have already stored the information it needs.

Can potentially find the wrong episode if there are missing seasons or incomplete seasons that it can't pull the final episode number from.


# Troubleshooting and Feature Requests
If you have any issues with mpvDLNA or have features you would like to request feel free to [make an issue](https://github.com/chachmu/mpvDLNA/issues/new/choose) or send me an email and I will try to take a look. As a warning I may not respond immediately or be willing to implement every feature but I always welcome feedback!
