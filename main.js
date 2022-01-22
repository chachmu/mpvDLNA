// mpvDLNA 3.3.1

"use strict";

mp.module_paths.push(mp.get_script_directory() + "/modules.js");
var Options = require('Options');
var Ass = require('AssFormat');
var SelectionMenu = require('SelectionMenu');
mp.module_paths.pop();


var DLNA_Node = function(name, id) {
    this.name = name;
    this.id = id;
    this.url = null;
    this.children = null;
    this.info = null; // format is {start: episode#, end: episode#, description: string}

    this.isPlaying = false;
    this.type = "node";
};


var DLNA_Server = function(name, url) {
    this.name = name;
    this.id = "0"
    this.url = url;
    this.children = null;

    this.type = "server"
};

// Helper function to remove first element and trailing newlines
var removeNL = function(sp) {
    for (var i = 0; i < sp.length; i++) {
        var s = sp[i]
        if (s[s.length - 1] == "\r") {
            s = s.slice(0, -1);
        }

        if (s[s.length - 1] == "\n") {
            s = s.slice(0, -1);
        }

        sp[i] = s;
    }

    if (!sp[0] || !sp[0].length) {
        sp.shift();
    }

    return sp;
};


// Class to browse DLNA servers
var DLNA_Browser = function(options) {

    options = options || {};

    // --------------------------

    this.showHelpHint = typeof options.showHelpHint === 'boolean' ?
        options.showHelpHint : true;

    this.descriptionSize = options.descriptionFontSize;
    if (this.descriptionSize === null) {
        this.descriptionSize = options.menuFontSize / 4.5;
    }

    this.menu = new SelectionMenu({ // Throws if bindings are illegal.
            maxLines: options.maxLines,
            menuFontSize: options.menuFontSize,
            autoCloseDelay: options.autoCloseDelay,
            keyRebindings: options.keyRebindings
    });
    this.menu.setMetadata({type:null});

    this._registerCallbacks();

    var self = this;


    // Only use menu text colors while mpv is rendering in GUI mode (non-CLI).
    this.menu.setUseTextColors(mp.get_property_bool('vo-configured'));
    mp.observe_property('vo-configured', 'bool', function(name, value) {
        self.menu.setUseTextColors(value);
    });


    // Determine how to call python
    this.python = null;
    var versions = ["python", "python3"];

    // If the .conf file specifies an option, test it first
    if (options.python_version) {
        versions.unshift(options.python_version);
    }

    // Test each option
    for (var i = 0; i < versions.length; i++) {
        var result = mp.command_native({
            name: "subprocess",
            playback_only: false,
            capture_stdout: true,
            capture_stderr: true,
            args : [versions[i], mp.get_script_directory()+"/mpvDLNA.py", "-v"]
        });

        if (result.status != 0) {
            mp.msg.debug("calling python as " + versions[i] + " errored with: " + result.stderr);
        } else {
            this.python = versions[i];
            break;
        }
    }

    // None of the options worked, throw an error
    if (this.python == null) {
        throw new Error("Unable to find a correctly configured python call: \n \
        in the following options: " + versions +
        "\n         Please add the name of your python install to the .conf file \n \
        using the format: python_version=python \n \
        or run mpv with the --msg-level=mpvDLNA=trace argument to see the errors");
    }

    // How long to spend searching for DLNA servers
    this.timeout = options.timeout

    // How many nodes to fetch from the DLNA server when making a request
    this.count = options.count

    // list of the parents of the current node.
    // The first element represents the server we are currently browsing
    // The last element represents the node we are currently on
    this.parents = [];

    // List of titles to combine to get the title of the menu
    this.titles = [];

    this.current_folder = [];

    // determine if we need to scan for DLNA servers next time the browser opens
    this.scan = true;
    this.servers = [];

    // handle servers listed in the config file
    for (var i = 0; i < options.serverNames.length; i++) {
        this.servers.push(new DLNA_Server(options.serverNames[i], options.serverAddrs[i]));
    }
    if (this.servers.length != 0) {
        this.menu.title = "Servers";
        this.current_folder = this.servers;
        this.menu.setOptions(this.servers, 0);

        this.scan = false;
    }

    // list of wake on lan mac addresses
    this.mac_addresses = options.macAddresses;

    // List of nodes added to playlist. Should mirror the MPV internal playlist.
    // This is necessary because in certain edge cases if a user were to be playing
    // an episode while browsing with the DLNA browser and left the folder that the
    // current episodes were in then we wouldn't be able to figure out where the
    // now playing indicator should be
    this.playlist = [];
    this.playingUrl = null;


    // Typing functionality
    this.typing_controls = {
        "ESC"     : function(self){ self.toggle_typing() },
        "ENTER"   : function(self){ self.typing_parse() },
        "LEFT"    : function(self){ self.typing_action("left") },
        "RIGHT"   : function(self){ self.typing_action("right") },
        "DOWN"    : function(self){ self.typing_action("down") },
        "UP"      : function(self){ self.typing_action("up") },
        "BS"      : function(self){ self.typing_action("backspace") },
        "CTRL+BS" : function(self){ self.typing_action("ctrl+backspace") },
        "DEL"     : function(self){ self.typing_action("delete") },
        "SPACE"   : function(self){ self.typing_action(" ") },
        "TAB"     : function(self){ self.typing_action("tab") }
    };

    this.typing_keys = [];
    for (var i = 33; i <= 126; i++) {
         this.typing_keys.push(String.fromCharCode(i));
    }

    this.typing_mode = "text";

    this.typing_active = false;
    this.typing_position = 0;
    this.typing_text = "";
    this.typing_output = "";
    this.autocomplete = [];
    this.selected_auto = {id: 0, full: ""};

    this.commands = {
        "scan" : { func: function(self){ self.menu.showMessage("Scanning");
                                         self.findDLNAServers();
                                         self.menu.showMessage("Scan Complete"); },
                   args: [],
                   text: false,
                   output: false},

        "cd"   : { func: function(self, file) { self.command_cd(file); },
                   args: [],
                   text: true,
                   output: false},

        "text" : { func: function(self, file){ self.typing_mode = "text";
                                               self.typing_text = "";
                                               self.typing_position = 0;
                                               self.typing_active = true;
                                               self.typing_action(""); },
                   args: [],
                   text: false,
                   output: false},

        "info" : { func: function(self, file){ var info = self.command_info(file);
                                               if (info === null) {this.typing_output = "No Information";}
                                               else{
                                                   self.typing_output = "Episode Number: "+info.start;
                                                   if (info.start != info.end) {self.typing_output += "-"+info.end;}
                                                   self.typing_output += Ass.size(self.descriptionSize, true)+"\nDescription: "+info.description;
                                               }},
                   args: [],
                   text: true,
                   output: true},
        "ep"   : { func: function(self, args, file){ self.command_ep(args, file); },
                   args: ["Episode"],
                   text: true,
                   output: true},

        "pep"  : { func: function(self, args, file){ var result = self.command_ep(args, file);
                                                     if (result) self.select(self.menu.getSelectedItem()) },
                   args: ["Episode"],
                   text: true,
                   output: true},

        "wake"   : { func: function(self, args){ self.command_wake(args); },
                   args: ["Mac Address"],
                   auto: function(self, index){ return self.mac_addresses; },
                   text: false,
                   output: true},
    };
    this.command_list = Object.keys(this.commands);

    // String key of the current command
    this.command = null;
    // List of already typed command arguments
    this.arguments = [];
    // List of unfinished typed command argument
    this.typing_argument= "";
    this.result_displayed = true;

    // Send startup MAC Address wake on lan packets
    options.startupMacAddresses.forEach(function(addr) { self.command_wake([addr]) });
};


DLNA_Browser.prototype.findDLNAServers = function() {
    this.scan = false;
    this.menu.title = "Scanning for DLNA Servers";
    this.menu.renderMenu("", 1);


    mp.msg.info("scanning for dlna servers");
    this.servers = [];

    // Increase the timeout if you have trouble finding a DLNA server that you know is working
    var result = mp.command_native({
        name: "subprocess",
        playback_only: false,
        capture_stdout: true,
        capture_stderr: true,
        args : [this.python, mp.get_script_directory()+"/mpvDLNA.py", "-l", this.timeout]
    });

    mp.msg.debug("mpvDLNA.py -l: " + result.stderr);

    // Get the output, delete the first element if empty, and remove trailing newlines
    var sp = removeNL(result.stdout.split("\n"));

    for (var i = 0; i < sp.length; i=i+3) {
        var server = new DLNA_Server(sp[i], sp[i+1]);
        this.servers.push(server);
    }
    this.menu.title = "Servers";
    this.parents = [];
    this.current_folder = this.servers;
    this.menu.setOptions(this.servers, 0);

    this.menu.renderMenu("", 1);
};


DLNA_Browser.prototype.toggle = function() {

    // Toggle the menu display state.
    if (this.menu.menuActive) {
        this.menu.hideMenu();
    } else {
        this.menu.showMenu();
        // Determine if we need to scan for DLNA servers
        if (this.scan) {
            this.menu.title = "Scanning for DLNA Servers";
            this.findDLNAServers();
        }
    }
};

// starts typing and sets mode to either "text" or "command"
DLNA_Browser.prototype.toggle_typing = function(mode) {

    if (!this.typing_active) {

        // if mode command is invalid just leave it on what it was before
        if (mode == "text" || mode == "command") {
            this.typing_mode = mode;
        }

        var self = this;
        Object.keys(this.typing_controls).forEach( function(key) {
            mp.add_forced_key_binding(key, "typing_"+key, function(){self.typing_controls[key](self)}, {repeatable:true})
        });

        this.typing_keys.forEach( function(key) {
            mp.add_forced_key_binding(key, "typing_"+key, function(){self.typing_action(key)}, {repeatable:true})
        });

        this.typing_text = "";
        this.typing_position = 0;
        this.typing_active = true;

        this.menu.showTyping();
        this.typing_action("");

    } else {
        this.typing_active=false;
        Object.keys(this.typing_controls).forEach( function(key) {
            mp.remove_key_binding("typing_"+key);
        });

        this.typing_keys.forEach( function(key) {
            mp.remove_key_binding("typing_"+key);
        });

        this.menu.hideTyping();
    }
};

DLNA_Browser.prototype.typing_action = function(key) {
    var tabbing = false;

    if (key.length == 1){
        // "\" does not play nicely with the formatting characters in the osd message
        if (key != "\\") {
            this.typing_text = this.typing_text.slice(0, this.typing_position)
                + key +  this.typing_text.slice(this.typing_position);
            this.typing_position+=1;
        }
    } else if (key == "backspace") {
        // can't backspace if at the start of the line
        var removed = "";
        if (this.typing_position) {
            removed = this.typing_text.slice(this.typing_position-1, this.typing_position);
            this.typing_text = this.typing_text.slice(0, this.typing_position-1)
            + this.typing_text.slice(this.typing_position);

            this.typing_position-= 1;
        }

        if (this.typing_mode == "command" && this.command != null) {
            // The backspace effected the command
            if (this.typing_position <= this.command.length) {
                this.command = null;
                this.typing_output = "";
            // The backspace effected an argument
            } else if (removed == " "){
                var arg_lengths = 0;
                this.arguments.forEach(function(arg){arg_lengths+=arg.length+1});

                if (this.typing_position <= this.command.length + arg_lengths + 1) {
                    this.arguments.pop();
                }
            }
        }
    } else if (key == "ctrl+backspace") {
        // May change this to delete the relevant filename/argument/command later
        // Right now it just clears all text
        this.typing_position = 0;
        this.typing_text = "";
        if (this.typing_mode == "command") {
            this.command = null;
            this.arguments = [];
            this.typing_argument = "";
        }
    } else if (key == "delete") {
        this.typing_text = this.typing_text.slice(0, this.typing_position)
            + this.typing_text.slice(this.typing_position+1);

        if (this.typing_mode == "command" && this.command != null) {
            if (this.typing_position <= this.command.length) {
                this.command = null;

                // Because we autoadd a space when completing a command and because
                // using delete means the cursor is not next to it, the space becomes
                // almost impossible to find. I wrote this code and still thought it
                // was a bug when the invisible space character supressed the autocorrect
                // Much easier for users to just not have to deal with it
                if (this.typing_text[this.typing_text.length-1] == " ") {
                    this.typing_text = this.typing_text.slice(0, -1);
                }
            }
        }

    } else if (key == "right") {
        this.typing_position += 1;
        if (this.typing_position > this.typing_text.length) {
            this.typing_position = 0;
        }

    } else if (key == "left") {
        this.typing_position -= 1;
        if (this.typing_position < 0) {
            this.typing_position = this.typing_text.length;
        }

    } else if (key == "tab" || key == "down") {
        tabbing = true;
        this.selected_auto.id++;
        if (this.selected_auto.id >= this.autocomplete.length) {
            this.selected_auto.id = 0;
        }

        if (this.autocomplete.length) {
            this.selected_auto.full = this.autocomplete[this.selected_auto.id].full;
        }
    } else if (key == "up") {
        tabbing = true;
        this.selected_auto.id--;
        if (this.selected_auto.id < 0) {
            this.selected_auto.id = this.autocomplete.length - 1;
        }

        if (this.autocomplete.length) {
            this.selected_auto.full = this.autocomplete[this.selected_auto.id].full;
        }
    } else if (key == "clear"){
        this.typing_text = "";

        this.typing_position = 0;
        this.autocomplete = [];
        this.selected_auto = {id: 0, full: ""};

        if (this.result_displayed) {
            this.typing_output = "";
        } else {
            this.result_displayed = true;
        }
    }

    var message = "";
    message += Ass.white(true) + this.typing_text.slice(0, this.typing_position);
    message += Ass.yellow(true) + "|";
    message += Ass.white(true) + this.typing_text.slice(this.typing_position);

    // Use command mode autocorrect.
    if (this.typing_mode == "command") {

        // Look for a valid command
        if (this.command == null) {
            this.arguments = [];

            // Check if the first piece of the input is a valid command
            if (this.typing_text.split(" ").length > 1) {
                var search = this.typing_text.split(" ")[0];

                for (var i = 0; i < this.command_list.length; i++) {
                    if (this.command_list[i].toUpperCase() == search.toUpperCase()) {
                        this.command = this.command_list[i];
                        break;
                    }
                }

            // Otherwise try to autocomplete the command
            } else {
                message = this.autocomplete_command(this.typing_text, message, tabbing, this.command_list);
            }
        }

        // Have a valid command, autocomplete the arguments
        if (this.command){
            // Let the user type arguments
            if (this.arguments.length < this.commands[this.command].args.length) {
                this.arguments = this.typing_text.split(" ").slice(1);
                this.typing_argument = this.arguments.pop();

                if (this.commands[this.command].auto != null) {
                    var arg_lengths = 0;
                    this.arguments.forEach(function(arg){arg_lengths+=arg.length+1});

                    var argument = this.typing_text.slice(this.command.length + arg_lengths + 1);

                    var index = message.split(" ").slice(0,-1).join(" ").length + 1
                    var msg = message.slice(index);
                    message = message.slice(0, index) + this.autocomplete_command(argument, msg, tabbing, this.commands[this.command].auto(this, this.arguments.length-1));
                }
            }

            // Display a hint about what kind of argument to enter
            if (this.arguments.length < this.commands[this.command].args.length) {
                this.typing_output = "Argument: " + this.commands[this.command].args[this.arguments.length];
            } else if (this.typing_output.split(":")[0] == "Argument"){
                this.typing_output = "";
            }

            // Have all the arguments, autocomplete the file
            if (this.arguments.length == this.commands[this.command].args.length &&
                this.commands[this.command].text){
                var arg_lengths = 0;
                this.arguments.forEach(function(arg){arg_lengths+=arg.length+1});

                var argument = this.typing_text.slice(this.command.length + arg_lengths + 1);
                this.typing_argument = "";

                var index = message.split(" ").slice(0,-1).join(" ").length + 1
                var msg = message.slice(index);
                message = message.slice(0, index) + this.autocomplete_text(argument, msg, tabbing);
            }

        }

        message = "$ " + message;

    // Use text mode autocorrect.
    } else if (this.typing_mode == "text") {
        message = this.autocomplete_text(this.typing_text, message, tabbing);
    }

    message = Ass.startSeq(true) + message;
    message += "\n" + Ass.alpha("00") + this.typing_output;
    message += Ass.stopSeq(true);
    this.menu.typingText = message;
    this.menu._renderActiveText();
};

// Try to find a valid command or folder
DLNA_Browser.prototype.typing_parse = function() {
    var success = false;

    // Planned Commands (more to come)
    //      search - Either query the DLNA server if thats possible or just manually search
    //  Y   cd - exactly the same as what text mode does now
    //  N   play - this has been replaced with just trying to cd into the media file
    //  Y   ep - find episode by number (maybe have option for absolute episode number instead of just its place in a season)
    //      pep - ep but starts playback
    //  Y   info - query DLNA server for metadata (For some reason my DLNA server only gives metadata for episodes, not seasons\shows)
    //  Y   text - switch to text input mode

    if (this.typing_mode == "command") {

        // This flag is used to make sure we don't accidentally autocomplete the command
        // and the arguments in a single enter keystroke
        var text_input = false;

        if (this.command == null) {
            text_input = true;
            if (this.autocomplete.length != 0) {
                this.command = this.selected_auto.full
                this.typing_text = this.selected_auto.full + " ";
                this.typing_position = this.typing_text.length;

                // This variable is true if the command requires more information than just its name
                text_input = this.commands[this.command].text || this.commands[this.command].args.length > 0;
            }
        }

        if (this.command != null && !text_input) {
            var cmd = this.commands[this.command];

            if (cmd.text) {
                // We have all the arguments and file text needed for the command
                if (cmd.args.length == this.arguments.length && this.autocomplete.length != 0) {
                    mp.msg.trace("Calling " + this.command + " with args: " + this.arguments);
                    if (this.arguments.length > 0) {
                        cmd.func(this, this.arguments, this.selected_auto.full);
                    } else {
                        cmd.func(this, this.selected_auto.full);
                    }

                    this.result_displayed = !cmd.output;
                    success = true;
                }
            } else {
                // Command only needs its name
                if (cmd.args.length == 0) {
                    mp.msg.trace("Calling " + this.command + " with no args");
                    cmd.func(this);
                    this.result_displayed = !cmd.output;
                    success = true;

                // We already have all but the last argument
                } else if (this.arguments.length == cmd.args.length - 1){
                    // Autocomplete the last argument
                    if (this.autocomplete.length != 0) {
                        this.arguments.push(this.selected_auto.full)

                    // Can't autocomplete the last argument, use what the user entered
                    } else {
                        this.arguments.push(this.typing_argument)
                    }

                    mp.msg.trace("Calling " + this.command + " with args: " + this.arguments);
                    cmd.func(this, this.arguments);
                    this.result_displayed = !cmd.output;
                    success = true;

                // Not enough arguments, autocomplete the one we are on
                } else {
                    if (this.autocomplete.length != 0) {

                        if (this.typing_argument.length != 0) {
                            this.typing_text = this.typing_text.slice(0, -this.typing_argument.length)
                        }

                        this.typing_text += this.selected_auto.full + " ";
                        this.typing_position = this.typing_text.length;
                    }
                }
            }
        }

    } else if (this.typing_mode == "text") {
        success = this.command_cd(this.selected_auto.full);
    }

    if (success) {
        this.command = null;
        this.typing_action("clear");
    } else {
        // Rescan for autocomplete
        this.typing_action("");
    }
};

// Works for commands and arguments
DLNA_Browser.prototype.autocomplete_command = function(text, message, tabbing, options) {
    // find new autocomplete options only if we are actually typing
    if (!tabbing) {
        this.autocomplete = [];

        if (this.options === null || (text == "" && this.selected_auto.full=="")) {
            this.selected_auto = {id: null, full: ""};
            return message;
        }

        for (var i = 0; i < options.length; i++) {
            var index = options[i].toUpperCase().indexOf(text.toUpperCase());

            if (index != -1) {
                this.autocomplete.push({
                     pre: options[i].slice(0, index),
                    post: options[i].slice(index + text.length),
                    full: options[i],
                  sindex: index,
                  findex: i
                });
            }
        }

        // Prefer the search term appearing as soon in the text as possible
        this.autocomplete.sort(function(a, b) {
            return a.sindex == b.sindex ? a.findex - b.findex : a.sindex-b.sindex;
        });
    }

    if (this.autocomplete.length > 0) {
        var search = this.selected_auto.full;
        // Prefer the earliest option in the list
        this.selected_auto = {
                     pre: this.autocomplete[0].pre,
                    post: this.autocomplete[0].post,
                    full: this.autocomplete[0].full,
                  sindex: this.autocomplete[0].sindex,
                  findex: this.autocomplete[0].findex,
                      id: 0
        }; // have to break this out or you get crazy referencing issues

        for (var i = 0; i < this.autocomplete.length; i++) {
            if (search == this.autocomplete[i].full) {
                this.selected_auto = {
                         pre: this.autocomplete[i].pre,
                        post: this.autocomplete[i].post,
                        full: this.autocomplete[i].full,
                      sindex: this.autocomplete[i].sindex,
                      findex: this.autocomplete[i].findex,
                          id: i
                }; // have to break this out or you get crazy referencing issues
                break;
            }
        }

        // Move the actively selected option to the front of the list so entries are
        // sorted by how close to the front of the string the search term is
        if (!tabbing) {
            this.autocomplete = [this.autocomplete[this.selected_auto.id]].concat(
                                this.autocomplete.slice(0,this.selected_auto.id),
                                this.autocomplete.slice(this.selected_auto.id+1));

            this.selected_auto = {
                         pre: this.autocomplete[0].pre,
                        post: this.autocomplete[0].post,
                        full: this.autocomplete[0].full,
                      sindex: this.autocomplete[0].sindex,
                      findex: this.autocomplete[0].findex,
                          id: 0
            }; // have to break this out or you get crazy referencing issues
        }

        message = Ass.alpha("DDDD6E") + this.selected_auto.pre
        + Ass.alpha("00") + message + Ass.alpha("DDDD6E") + this.selected_auto.post;
    } else {
        this.selected_auto = {id: 0, full: ""};
    }

    return message;
}


DLNA_Browser.prototype.autocomplete_text = function(text, message, tabbing) {

    // find new autocomplete options only if we are actually typing
    if (!tabbing) {
        this.autocomplete = [];

        // add ".." to the list of autocomplete options
        var options = this.current_folder.concat({name: ".."});

        for (var i = 0; i < options.length; i++) {
            var item = options[i];
            var index = item.name.toUpperCase().indexOf(text.toUpperCase());

            if ((item.children == null || item.children.length != 0) && index != -1) {
                this.autocomplete.push({
                     pre:  item.name.slice(0, index),
                    post: item.name.slice(index + text.length),
                    full: item.name,
                  sindex: index,
                  findex: i
                });
            }
        }

        // Prefer the search term appearing as soon in the text as possible
        this.autocomplete.sort(function(a, b) {
            return a.sindex == b.sindex ? a.findex - b.findex : a.sindex-b.sindex;
        });
    }

    if (this.autocomplete.length > 0) {
        var search = this.selected_auto.full;

        this.selected_auto = {
                     pre: this.autocomplete[0].pre,
                    post: this.autocomplete[0].post,
                    full: this.autocomplete[0].full,
                  sindex: this.autocomplete[0].sindex,
                  findex: this.autocomplete[0].findex,
                      id: 0
        }; // have to break this out or you get crazy referencing issues

        for (var i = 0; i < this.autocomplete.length; i++) {
            if (search == this.autocomplete[i].full) {
                this.selected_auto = {
                             pre: this.autocomplete[i].pre,
                            post: this.autocomplete[i].post,
                            full: this.autocomplete[i].full,
                          sindex: this.autocomplete[i].sindex,
                          findex: this.autocomplete[i].findex,
                              id: i
                }; // have to break this out or you get crazy referencing issues

                break;


            }
        }

        // Move the actively selected option to the front of the list so entries are
        // sorted by how close to the front of the string the search term is
        if (!tabbing) {
            this.autocomplete = [this.autocomplete[this.selected_auto.id]].concat(
                                this.autocomplete.slice(0,this.selected_auto.id),
                                this.autocomplete.slice(this.selected_auto.id+1));

            this.selected_auto = {
                         pre: this.autocomplete[0].pre,
                        post: this.autocomplete[0].post,
                        full: this.autocomplete[0].full,
                      sindex: this.autocomplete[0].sindex,
                      findex: this.autocomplete[0].findex,
                          id: 0
            }; // have to break this out or you get crazy referencing issues
        }

        // Update the menu selection to match
        this.menu.selectionIdx = this.selected_auto.findex;
        this.menu.renderMenu("", 1);

        message = Ass.alpha("DDDD6E") + this.selected_auto.pre
        + Ass.alpha("00") + message + Ass.alpha("DDDD6E") + this.selected_auto.post;
    } else {
        this.selected_auto = {id: 0, full: ""};
    }

    return message;
}


DLNA_Browser.prototype.command_cd = function(text) {
    var success = false;
    if (text == "..") {
        this.back();
        success = true;
    }else {

        for (var i = 0; i < this.current_folder.length; i++) {
            var item = this.current_folder[i];

            if (text == item.name) {
                success = this.select(item);
            }
        }
    }

    return success
}

DLNA_Browser.prototype.command_info = function(text) {
    if (text == "..") {
        return null;
    }

    var selection = null;
    for (var i = 0; i < this.current_folder.length; i++) {
        var item = this.current_folder[i];

        if (text == item.name) {
            selection = item;
        }
    }

    return this.info(selection);
}

DLNA_Browser.prototype.command_ep = function(args, text) {
    if (text == "..") {
        return false;
    }

    var selection = null;
    for (var i = 0; i < this.current_folder.length; i++) {
        var item = this.current_folder[i];

        if (text == item.name) {
            selection = item;
        }
    }

    if (!selection) {
       return false;
    }

    var target = parseInt(args[0]);

    var episode = 0;
    selection.children = this.getChildren(selection);
    for (var i = 0; i < selection.children.length; i++) {
        this.typing_output = "Scanning: "+ selection.children[i].name + ", reached E" + episode;
        this.result_displayed = false;
        this.typing_action("");

        var info = this.info(selection.children[i]);
        if (info === null) {
            return false; // can't get enough information to find the episode
        } else if (isNaN(info.end)) {
            continue; // Maybe need to find a better check for this
        }

        if (target <= episode + info.end) {

            // Season based episode# target
            var s_target = target - episode;

            selection.children[i].children = this.getChildren(selection.children[i]);
            for (var j = 0; j < selection.children[i].children.length; j++) {
                this.typing_output = "Scanning: "+ selection.children[i].name + ", reached E" + episode;
                this.result_displayed = false;
                this.typing_action("");
                episode++;

                var episode_info = this.info(selection.children[i].children[j]);

                if (episode_info === null) {
                    continue;
                }

                // episode contains target episode
                if (episode_info.start <= s_target && s_target <= episode_info.end) {
                    this.select(selection.children[i]);
                    this.menu.selectionIdx = j;
                    this.menu.renderMenu("", 1);

                    // Make the output look nice
                    var E = episode_info.start;
                    if (E < 10) {
                        E = "0"+E;
                    }

                    if (episode_info.start != episode_info.end) {
                        if (episode_info.end < 10) {
                            E += "0";
                        }
                        E +="-E"+episode_info.end;
                    }

                    if (target < 10) {
                        target = "0"+target;
                    }

                    this.typing_output = selection.name+" E"+target+" = "+selection.children[i].name+" E"+E;
                    return true;
                }
            }

            break;
        }

        episode += info.end;
    }

    if (target < 10) {
        target = "0"+target;
    }
    this.typing_output = Ass.color("FF0000", true) + "Failed to find "+selection.name+" E"+target
    return false;
}

DLNA_Browser.prototype.command_wake = function(args) {
    if (args[0] === null) {
        this.typing_output = Ass.color("FF0000", true) + "MAC Address cannot be null";
        return;
    }

    var result = mp.command_native({
            name: "subprocess",
            playback_only: false,
            capture_stdout: true,
            capture_stderr: true,
            args : [this.python, mp.get_script_directory()+"/mpvDLNA.py", "-w", args[0]]
        });

    mp.msg.debug("mpvDLNA.py -w: " + result.stderr);

    // Get the output, delete the first element if empty, and remove trailing newlines
    var sp = removeNL(result.stdout.split("\n"));

    if (sp[0] == "packet sent") {
        this.typing_output = "Packet Sent";
    } else if (sp[0] == "import failed"){
        this.typing_output = Ass.color("FF0000", true) + "wakeonlan python package not installed";
    } else {
        this.typing_output = Ass.color("FF0000", true) + "unspecified error";
    }
}



// This function adds the previous and next episodes to the playlist,
// changes the window title to the current episode title, and
// updates the now playing indicator
DLNA_Browser.prototype.on_file_load = function() {

    // DLNA isn't being used
    if (this.playlist.length == 0) {
        return;
    }

    mp.msg.trace("on_file_load");

    var p_index = mp.get_property_number("playlist-playing-pos", 1);
    var playlist = mp.get_property_native("playlist", {});

    var episode_number = null
    for (var i = 0; i < this.playlist.length; i++) {
        if (this.playlist[i].url == playlist[p_index].filename) {
            episode_number = i;
            break;
        }
    };

    if (episode_number === null) {
        mp.msg.warn("The DLNA playlist is not properly synced with the internal MPV playlist");
        return
    }

    var episode = this.playlist[episode_number];
    var folder = episode.folder.children; // The code below is very confusing if you forget that folder != episode.folder


    // Update the now playing indicator and rerender the menu if necessary
    folder[episode.id].isPlaying = true;
    this.menu.renderMenu("", 1);

    // Set the title to match the current episode
    mp.msg.trace("setting title to: " + episode.folder.name + ": " + folder[episode.id].name);
    mp.set_property("force-media-title", episode.folder.name + ":   " + folder[episode.id].name);
    this.playingUrl = episode.url;


    // If there is a previous episode
    if (episode.id - 1 >= 0) {
        // and the playlist entry before this one either doesn't exist or isn't the previous episode
        if (p_index-1 < 0 || playlist[p_index-1].filename != folder[episode.id-1].url) {
            var prev = folder[episode.id-1];
            mp.commandv("loadfile", prev.url, "append");

            // Move the last element in the list (the one we just appended) to in front of the current episode
            mp.commandv("playlist-move", playlist.length, p_index);

            this.playlist.push({ folder: episode.folder,
                                     id: episode.id-1,
                                    url: prev.url
            });
            mp.msg.trace("Added previous episode to playlist");
        }
    }

    // If there is a next episode
    if (episode.id + 1 < folder.length) {
        // and the playlist entry after this one either doesn't exist or isn't the next episode
        if (p_index+1 >= playlist.length || playlist[p_index+1].filename != folder[episode.id+1].url) {
            var next = folder[episode.id+1];
            mp.commandv("loadfile", next.url, "append");

            // Move the last element in the list (the one we just appended) to behind the current episode
            mp.commandv("playlist-move", playlist.length, p_index+1);

            this.playlist.push({ folder: episode.folder,
                                     id: episode.id+1,
                                    url: next.url
            });
            mp.msg.trace("Added next episode to playlist");
        }
    }
};

// Removes the now playing indicator
DLNA_Browser.prototype.on_file_end = function() {
    // DLNA isn't being used
    if (this.playlist.length == 0) {
        return;
    }

    for (var i = 0; i < this.playlist.length; i++) {
        if (this.playlist[i].url == this.playingUrl) {
            var episode = this.playlist[i];
            episode.folder.children[episode.id].isPlaying = false;
            break;
        }
    };

};


DLNA_Browser.prototype.generateMenuTitle = function() {
    this.menu.title=this.titles[this.titles.length-1];

    // Already have the first element
    for (var i = this.titles.length-2; i >= 0; i-- ) {
        // Condense repeat menu titles by only using the more specific one
        if (this.titles[i+1].indexOf(this.titles[i]) == -1) {
            this.menu.title = this.titles[i] + " / " + this.menu.title;

            if (this.menu.title.length > 90) {
                this.menu.title = this.menu.title.slice(this.titles[i].length + 3, this.menu.title.length);
                break;
            }
        }
    }
};

DLNA_Browser.prototype.getChildren = function(selection) {

    // This node has not been loaded before, fetch its children from the server
    if (selection.children == null) {
        var result = mp.command_native({
            name: "subprocess",
            playback_only: false,
            capture_stdout: true,
            capture_stderr: true,
            args : [this.python, mp.get_script_directory()+"/mpvDLNA.py", "-b", this.parents[0].url, selection.id, this.count]
        });

        var categories = result.stdout.split("----")
        var children = [];

        // Check for items, then collections
        for (var category = 0; category < 2; category++) {
            // Get the output, delete the first element if empty, and remove trailing newlines
            var sp = removeNL(categories[category].split("\n"));

            // Tells us if we are getting item or container type data
            var is_item = sp[0] == "items:";
            var increase = (is_item ? 4 : 3);
            var max_length = (is_item ? 1 : 2)

            // The first 2 elements of sp are not useful here
            for (var i = 2; i+max_length < sp.length; i=i+increase) {

                var child = new DLNA_Node(sp[i], sp[i+1]);

                if (is_item) {
                    child.url = sp[i+2];
                }

                children.push(child);
            }
        }
        selection.children = children;
    }

    return selection.children
}

DLNA_Browser.prototype.select = function(selection) {
    mp.msg.debug("selecting");
    if (!selection) {
        mp.msg.debug("selection was invalid");
    }

    if (selection.type == "server") {
        mp.msg.debug("selecting server: " + selection.name);
        this.parents = [selection];
        this.titles = [];
    } else if (selection.type == "node") {
        mp.msg.debug("selecting node: " + selection.name);
        if (selection.url === null) {
            this.parents.push(selection)
        } else {
            mp.msg.info("Loading " + selection.name + ": " + selection.url);
            mp.commandv("loadfile", selection.url, "replace");

            // Clear the DLNA playlist of playing indicators and replace it with the new playlist
            this.playlist.forEach(function(episode){episode.folder.children[episode.id].isPlaying = false});
            this.playlist = [{folder: this.parents[this.parents.length-1],
                                  id: this.parents[this.parents.length-1].children.indexOf(selection),
                                 url: selection.url
            }];

            this.menu.hideMenu();
            if (this.typing_active) {
                this.toggle_typing();
            }

            return true;
        }
    } else {
        // This should never happen
        mp.msg.debug("selection type invalid");
        return false;
    }

    // This will load the children if they haven't been already
    this.parents[this.parents.length-1].children = this.getChildren(selection);

    var success = false;

    // If the selection has no children then don't bother moving to it
    if (this.parents[this.parents.length-1].children.length == 0) {
        mp.msg.debug("selection was empty");
        this.parents.pop();
    } else {
        // Update the title and menu to the new selection
        this.titles.push(selection.name);
        this.generateMenuTitle();
        mp.msg.trace("generated menu title");

        this.current_folder = this.parents[this.parents.length-1].children;
        mp.msg.trace("set current folder");
        this.menu.setOptions(this.parents[this.parents.length-1].children, 0);
        mp.msg.trace("set options");
        success = true;
    }

    this.menu.renderMenu("", 1);
    return success;
}

DLNA_Browser.prototype.info = function(selection) {
    if (selection === null) {
        return null;
    }

    // This node has not loaded its info before, fetch its metadata
    if (selection.info == null) {
        var result = mp.command_native({
            name: "subprocess",
            playback_only: false,
            capture_stdout: true,
            capture_stderr: true,
            args : [this.python, mp.get_script_directory()+"/mpvDLNA.py", "-i", this.parents[0].url, selection.id, this.count]
        });

        mp.msg.debug("mpvDLNA.py -i: " + result.stderr);

        // Get the output, delete the first element if empty, and remove trailing newlines
        var sp = removeNL(result.stdout.split("\n"));

        var info = {start: 1, end: 1, description: ""}

        // Tells us if we are getting item or container type data
        var is_item = sp[0] == "item";

        if (is_item) {
            // The first 2 elements of sp are not useful here, get the episode number
            if (sp[2] != "No Episode Number") {
                info.start = parseInt(sp[2]);
                info.end = info.start;

                // figure out if this is actually multiple episodes
                var title_split = selection.name.split(" - ");
                if (!/^\d+$/.test(title_split[0])) {
                    var ep_split = title_split[0].split("-");
                    info.end = parseInt(ep_split[1]);
                }
            }
        } else {

            selection.children = this.getChildren(selection);
            if (selection.children.length != 0) {
                var start_info = this.info(selection.children[0]);
                var end_info = this.info(selection.children[selection.children.length-1])
                info.start = start_info.start;
                info.end = end_info.end;
            }
        }

        // Everything else is the description (for some reason my DLNA server doesn't send descriptions for seasons/series, only episodes)
        info.description = sp.slice(3).join("\n")
        // Sometimes the description gets a little mangled but it seems like the issue is on the DLNA server side

        selection.info = info;
    }

    return selection.info;
}

DLNA_Browser.prototype.back = function() {
    this.parents.pop();
    this.titles.pop();

    if (this.parents.length == 0) {
        this.current_folder = this.servers;
        this.menu.setOptions(this.servers, 0);
        this.menu.title = "Servers";
    } else {
        this.current_folder = this.parents[this.parents.length-1].children;
        this.menu.setOptions(this.parents[this.parents.length-1].children, 0);
        this.generateMenuTitle(this.titles[this.titles.length-1]);
    }

    this.menu.renderMenu("", 1);
}

DLNA_Browser.prototype._registerCallbacks = function() {

    var self = this; // Inside the callbacks this will end up referring to menu instead of DLNA_Browser

    this.menu.setCallbackMenuOpen(function() {
         self.select(this.getSelectedItem());
    });


    this.menu.setCallbackMenuLeft(function() {
        self.back();
    });

    this.menu.setCallbackMenuRight(function() {
       self.select(this.getSelectedItem());
    });
};



(function() {
    // Read user configuration (uses defaults for any unconfigured options).
    // * You can override these values via the configuration system, as follows:
    // - Via permanent file: `<mpv config dir>/script-settings/Blackbox.conf`
    // - Command override: `mpv --script-opts=mpvDLNA-server_names="{name1}+{name2}"`
    // - Or by editing this file directly (not recommended, makes your updates harder).
    var userConfig = new Options.advanced_options({
        // How long to keep the menu open while you are idle.
        // * (float/int) Ex: `10` (ten seconds), `0` (to disable autoclose).
        auto_close: 0,
        // Maximum number of file selection lines to show at a time.
        // * (int) Ex: `20` (twenty lines). Cannot be lower than 3.
        max_lines: 10,
        // What font size to use for the menu text. Large sizes look the best.
        // * (int) Ex: `42` (font size fourtytwo). Cannot be lower than 1.
        font_size: 40,
        description_font_size: 12,
        // Whether to show the "[h for help]" hint on the first launch.
        // * (bool) Ex: `yes` (enable) or `no` (disable).
        help_hint: true,

        server_names: '',
        server_addrs: '',
        mac_addresses: '',
        startup_mac_addresses:'',
        python_version: '',
        timeout: '1',
        count: '2000',

        // Keybindings. You can bind any action to multiple keys simultaneously.
        // * (string) Ex: `{up}`, `{up}+{shift+w}` or `{x}+{+}` (binds to "x" and the plus key).
        // - Note that all "shift variants" MUST be specified as "shift+<key>".
        'keys_menu_up': '{up}',
        'keys_menu_down': '{down}',
        'keys_menu_up_fast': '{shift+up}',
        'keys_menu_down_fast': '{shift+down}',
        'keys_menu_left': '{left}',
        'keys_menu_right': '{right}',
        'keys_menu_open': '{enter}',
        'keys_menu_undo': '{bs}',
        'keys_menu_help': '{h}',
        'keys_menu_close': '{esc}'
    });

    // Create and initialize the media browser instance.
    try {
        var browser = new DLNA_Browser({
            autoCloseDelay: userConfig.getValue('auto_close'),
            maxLines: userConfig.getValue('max_lines'),
            menuFontSize: userConfig.getValue('font_size'),
            descriptionFontSize: userConfig.getValue('description_font_size'),
            showHelpHint: userConfig.getValue('help_hint'),
            serverNames: userConfig.getMultiValue('server_names'),
            serverAddrs: userConfig.getMultiValue('server_addrs'),
            macAddresses: userConfig.getMultiValue('mac_addresses'),
            startupMacAddresses: userConfig.getMultiValue('startup_mac_addresses'),
            python_version: userConfig.getValue('python_version'),
            timeout: userConfig.getValue('timeout'),
            count: userConfig.getValue('count'),
            keyRebindings: {
                'Menu-Up': userConfig.getMultiValue('keys_menu_up'),
                'Menu-Down': userConfig.getMultiValue('keys_menu_down'),
                'Menu-Up-Fast': userConfig.getMultiValue('keys_menu_up_fast'),
                'Menu-Down-Fast': userConfig.getMultiValue('keys_menu_down_fast'),
                'Menu-Left': userConfig.getMultiValue('keys_menu_left'),
                'Menu-Right': userConfig.getMultiValue('keys_menu_right'),
                'Menu-Open': userConfig.getMultiValue('keys_menu_open'),
                'Menu-Undo': userConfig.getMultiValue('keys_menu_undo'),
                'Menu-Help': userConfig.getMultiValue('keys_menu_help'),
                'Menu-Close': userConfig.getMultiValue('keys_menu_close')
            }
        });
    } catch (e) {
        mp.msg.error('DLNA: '+e+'.');
        mp.osd_message('DLNA: '+e.stack+'.', 30);
        throw e; // Critical init error. Stop script execution.
    }

    // Provide the bindable mpv command which opens/cycles through the menu.
    // * Bind this via input.conf: `ctrl+b script-binding Blackbox`.
    // - To get to your favorites (if you've added some), press this key twice.
    mp.add_key_binding(null, 'toggle_mpvDLNA', function() {
        browser.toggle();
    });

    mp.add_key_binding(null, 'text_mpvDLNA', function(){
        browser.toggle_typing("text");
    })

    mp.add_key_binding(null, 'command_mpvDLNA', function(){
        browser.toggle_typing("command");
    })

    // Handle necessary changes when loading the next file
    // such as adding the next and previous episodes to the playlist
    // and updating the window title to match the episode title
    mp.register_event("file-loaded", function() {
        browser.on_file_load();
    });

    // Handle necessary changes when ending the current file
    // such as marking it as no longer playing
    mp.register_event("end-file", function() {
        browser.on_file_end();
    });
})();
