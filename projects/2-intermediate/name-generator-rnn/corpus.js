/*
 * Training data for the name RNN: a plain list of ~260 human first names, all
 * lowercase. The network never sees these as "labels" — it learns the letter
 * transitions inside them and then invents names that follow the same feel.
 * Works in the browser (window.NAME_CORPUS) and Node (module.exports).
 */
(function (root) {
  'use strict';
  var NAMES = [
    'aaliyah','abigail','adam','adrian','aiden','alan','alba','albert','alberto','alexander',
    'alexis','alice','alicia','amanda','amara','amber','amelia','amira','anders','andrea',
    'andrew','angela','anita','anna','annabel','anthony','antonio','ariana','arthur','ashley',
    'aubrey','austin','ava','avery','barbara','beatrice','bella','benjamin','bianca','blake',
    'brandon','brenda','brian','brianna','bridget','brooke','bruno','caleb','callum','camila',
    'carla','carlos','carmen','caroline','carter','cassandra','catalina','catherine','cecilia','charles',
    'charlotte','chloe','chris','christian','christine','clara','claudia','colin','connor','cora',
    'daniel','daniela','danielle','david','dawn','dennis','derek','diana','diego','dominic',
    'donna','dorothy','dylan','edward','eleanor','elena','eliana','elijah','elise','elizabeth',
    'ella','ellie','emanuel','emil','emilia','emily','emma','enzo','eric','erica',
    'esteban','esther','ethan','eugene','eva','evelyn','ezra','felix','fernanda','fiona',
    'florence','frances','francis','francisco','gabriel','gabriela','gavin','genevieve','george','georgia',
    'gerald','gianna','grace','grant','gregory','hailey','hannah','harold','harper','harrison',
    'harry','hazel','heather','hector','helena','henry','holly','hugo','ian','irene',
    'isaac','isabel','isabella','isaiah','ivan','ivy','jack','jackson','jacob','jade',
    'james','jasmine','jason','javier','jayden','jennifer','jeremy','jessica','joana','joaquin',
    'joel','john','jonas','jonathan','jordan','jorge','joseph','joshua','juan','judith',
    'julia','julian','juliana','june','justin','kaitlyn','karen','katherine','kayla','keira',
    'kevin','kimberly','lana','laura','lauren','leah','leon','leonardo','levi','liam',
    'lila','lilian','lily','lincoln','linda','logan','lorena','lorenzo','louis','lucas',
    'lucia','lucy','luis','luna','mabel','madeline','madison','malik','marco','margaret',
    'maria','mariana','marina','mario','marisol','mark','martha','martin','mason','mateo',
    'matthew','maximilian','maya','melanie','melissa','mia','micah','michael','michelle','miguel',
    'mila','miles','molly','morgan','nadia','naomi','natalia','nathan','nathaniel','nicholas',
    'nicolas','nina','noah','nolan','nora','olivia','oliver','omar','oscar','owen',
    'pablo','paige','patricia','patrick','paula','penelope','peter','philip','pierre','preston',
    'priscilla','quentin','rachel','rafael','ramona','raymond','rebecca','regina','renata','ricardo',
    'richard','riley','robert','roberto','rodrigo','roman','rosa','rowan','ruben','ruby',
    'ryan','sabrina','salma','samantha','samuel','sandra','santiago','sara','sarah','sawyer',
    'scarlett','sebastian','selena','serena','seth','shane','sharon','sienna','silas','simon',
    'sofia','sophia','stella','stephen','susana','sydney','tessa','theodore','thomas','tiffany',
    'timothy','tobias','tomas','travis','tristan','ursula','valentina','valerie','vanessa','vera',
    'veronica','victor','victoria','vincent','violet','virginia','walter','wesley','william','willow',
    'wyatt','xavier','ximena','yara','yasmin','zachary','zara','zoe'
  ];
  if (typeof module !== 'undefined' && module.exports) module.exports = NAMES;
  else root.NAME_CORPUS = NAMES;
})(typeof window !== 'undefined' ? window : this);
