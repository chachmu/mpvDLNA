import sys
import upnpclient

from lxml import etree
import logging
# important information is passed through stdout so we need to supress
# the output of the upnp client module
logging.getLogger("upnpclient").setLevel(logging.CRITICAL)


def browse(url, id):
    device = upnpclient.Device(url)
    result = device.ContentDirectory.Browse(ObjectID=id, BrowseFlag="BrowseDirectChildren", Filter="*", StartingIndex=0, RequestedCount=2000, SortCriteria="")
    root = etree.fromstring(result["Result"])

    # Determine if we should be looking at items or containers
    list = root.findall("./item", root.nsmap)
    type = "item"
    if len(list) == 0:
        list = root.findall("./container", root.nsmap)
        type = "container"
    
    print(type)
    for t in list:
        print("")
        print(t.findtext("dc:title", "untitled", root.nsmap))
        print(t.get("id"))
        
        if type == "item":
            print(t.findtext("res", "", root.nsmap))
            
            
def list(timeout):
    devices = []
    
    possibleDevices = upnpclient.discover(timeout)
    for device in possibleDevices:
        if "MediaServer" in device.device_type:
            addToList = True
            for d in devices:
                if d.friendly_name == device.friendly_name:
                    addToList = False
                    break
            
            if addToList:
                devices.append(device)


    for device in devices:
        print("")
        print(device.friendly_name)
        print(device.location)
        

    #Remove this when done testing
    print("")
    print("Placeholder Server")
    print("thisurlisblank")
    

def help():
    print("mpvDLNA.py requires a single command line argument")
    print("-h, --help     Prints the help dialog")
    print("-v, --version  Prints version information")
    print("-l, --list     Takes a timeout in seconds and outputs a list of DLNA Media Servers on the network")
    print("-b, --browse   Takes a DLNA url and the id of a DLNA element and outputs its direct children")
    

if len(sys.argv) == 2:
    if sys.argv[1] == "-v" or sys.argv[1] == "--version":
        print("mpvDLNA Plugin Version 0.0.1")
    else:
        help()
elif len(sys.argv) == 3:
    if sys.argv[1] == "-l" or sys.argv[1] == "--list":
        list(int(sys.argv[2]))
    else:
        help()
elif len(sys.argv) == 4:
    if sys.argv[1] == "-b" or sys.argv[1] == "--browse":
       browse(sys.argv[2], sys.argv[3])
    else:
        help()
else:
    help()